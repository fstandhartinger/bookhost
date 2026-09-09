#!/usr/bin/env python3
"""Read-only live assertions for two initialized tenants. No secrets are printed."""
import json
import sys
import tenant


def inspect(container):
    return json.loads(tenant.run(['sudo','-n','docker','inspect',container]))[0]


def verify(a, b):
    for slug in (a,b):
        if not tenant.valid_slug(slug) and slug!='demo': raise ValueError('Invalid slug')
    for source, target in ((a,b),(b,a)):
        path=tenant.ROOT/source
        db_name='wissen-'+target+'-db-1'
        remote=inspect(db_name)
        assert set(remote['NetworkSettings']['Networks'])=={'wissen-'+target+'-internal'}
        remote_ip=remote['NetworkSettings']['Networks']['wissen-'+target+'-internal']['IPAddress']
        for service in ('db','bookstack'):
            obj=inspect('wissen-'+source+'-'+service+'-1')
            assert 'no-new-privileges:true' in obj['HostConfig']['SecurityOpt']
            assert not obj['HostConfig']['CapAdd'] and not obj['HostConfig']['Privileged']
            assert not obj['HostConfig']['PortBindings']
        net=json.loads(tenant.run(['sudo','-n','docker','network','inspect','wissen-'+source+'-internal']))[0]
        assert net['Internal'] is True
        # DNS must have no answer, independently of the TCP check by literal IP.
        tenant.compose(path,'exec','-T','bookstack','sh','-c',
                           'getent hosts "$1" >/dev/null 2>&1; result=$?; test "$result" -eq 2', 'sh',db_name)
        code='$s=@fsockopen($argv[1],(int)$argv[2],$e,$m,3); if($s){fclose($s);exit(0);}exit(7);'
        tenant.compose(path,'exec','-T','bookstack','sh','-c',
            'php -r "$1" "$2" 3306; result=$?; test "$result" -eq 7','sh',code,remote_ip)
        assert tenant.php(path,"echo Illuminate\\Support\\Facades\\DB::selectOne('SELECT 1 AS ok')->ok;")==b'1'
        proxy_ip=inspect('wissen-'+target+'-bookstack-1')['NetworkSettings']['Networks']['coolify']['IPAddress']
        tenant.compose(path,'exec','-T','bookstack','php','-r',code,proxy_ip,'80')
        print(source+' -> '+target+': foreign DB DNS blocked; foreign DB IP:3306 blocked; own DB query OK; shared-proxy app TCP:80 reachable (accepted)')

if __name__=='__main__':
    if len(sys.argv)!=3: raise SystemExit('Usage: verify-network.py <tenant-a> <tenant-b>')
    verify(*sys.argv[1:])
