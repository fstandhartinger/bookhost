#!/usr/bin/env python3
"""Isolated BookStack tenant lifecycle. Never prints subprocess output or secrets."""
import base64, contextlib, fcntl, json, os, re, secrets, shlex, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
ROOT = Path('/home/flori/ventures2/bookstack/tenants')
HERE = Path(__file__).resolve().parent
IMAGE = 'lscr.io/linuxserver/bookstack:v26.05.4-ls283'
DB_IMAGE = 'mariadb:11.4@sha256:611a2fcc5fa7c6ceb8644c6f74b25ede004ff6c3a6b38c8f8c23d3bbf6c26430'
os.umask(0o077)

def run(args, data=None):
    p = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode: raise RuntimeError('Command failed: ' + ' '.join(args[:4]))
    return p.stdout

def env_read(path):
    values = {}
    for line in path.read_text().splitlines():
        parts = shlex.split(line, comments=True)
        if parts and parts[0] == 'export': parts.pop(0)
        if not parts: continue
        if len(parts) != 1 or '=' not in parts[0]: raise ValueError('Unsupported env syntax')
        key, value = parts[0].split('=',1); values[key] = value
    return values

def compose(path, *args, data=None):
    return run(['sudo','-n','docker','compose','--project-directory',str(path),'-p','wissen-'+path.name,'-f',str(path/'docker-compose.yml'),*args], data)

def config(path, public=True):
    slug = path.name; host = slug+'.wissen.app.mintapis.com'; router='wissen-'+slug
    app = dict(image=IMAGE, restart='unless-stopped', mem_limit='512m', environment={'PUID':'1000','PGID':'1000','TZ':'UTC','APP_URL':'${APP_URL}','APP_KEY':'${APP_KEY}','DB_HOST':'db','DB_PORT':'3306','DB_USERNAME':'bookstack','DB_PASSWORD':'${DB_PASSWORD}','DB_DATABASE':'bookstack'}, volumes=['./bookstack:/config'], depends_on={'db':{'condition':'service_healthy'}}, networks=['private'])
    db = dict(image=DB_IMAGE, restart='unless-stopped',mem_limit='512m', environment={'MARIADB_DATABASE':'bookstack','MARIADB_USER':'bookstack','MARIADB_PASSWORD':'${DB_PASSWORD}','MARIADB_ROOT_PASSWORD':'${DB_ROOT_PASSWORD}'},volumes=['./database:/var/lib/mysql'],networks=['private'],healthcheck={'test':['CMD','healthcheck.sh','--connect','--innodb_initialized'],'interval':'5s','timeout':'5s','retries':60}, command=['--innodb-buffer-pool-size=128M','--max-connections=50'])
    networks = {'private':{'internal':True}}
    if public:
        app['networks'].append('coolify'); networks['coolify']={'external':True,'name':'coolify'}
        labels={'traefik.enable':'true','traefik.docker.network':'coolify',f'traefik.http.services.{router}.loadbalancer.server.port':'80',f'traefik.http.middlewares.{router}-redirect.redirectscheme.scheme':'https'}
        for scheme in ['http','https']:
            prefix=f'traefik.http.routers.{router}-{scheme}'
            labels.update({prefix+'.rule':f'Host(`{host}`)',prefix+'.entrypoints':scheme,prefix+'.service':router})
            if scheme=='https': labels.update({prefix+'.tls':'true',prefix+'.tls.certresolver':'letsencrypt'})
            else: labels[prefix+'.middlewares']=router+'-redirect'
        app['labels']=labels
    else: app['labels']={'traefik.enable':'false'}
    (path/'docker-compose.yml').write_text(json.dumps({'services':{'bookstack':app,'db':db},'networks':networks},indent=2)+'\n')

def php(path, code, payload=None):
    # Payload passes only through stdin, never argv or Docker environment metadata.
    script="require '/app/www/vendor/autoload.php'; $app=require '/app/www/bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); "+code
    return compose(path,'exec','-T','-w','/app/www','bookstack','php','-r',script,data=json.dumps(payload or {}).encode())

def ready_internal(path):
    for _ in range(120):
        try:
            php(path,"$m=app('migrator'); $pending=array_diff(array_keys($m->getMigrationFiles(database_path('migrations'))),$m->getRepository()->getRan()); if(count($pending)) {exit(1);} echo 'ready';")
            return
        except RuntimeError: time.sleep(5)
    raise RuntimeError('BookStack initialization timed out')

def public_ready(url):
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url+'/login',timeout=10) as r:
                if r.status==200 and b'BookStack' in r.read(): return
        except Exception: pass
        time.sleep(5)
    raise RuntimeError('HTTPS login readiness timed out')

def provision(path,email):
    if not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+',email): raise ValueError('Invalid admin email')
    ef=path/'.env'
    fresh=not ef.exists()
    if fresh:
        values={'APP_URL':'https://'+path.name+'.wissen.app.mintapis.com','APP_KEY':'base64:'+base64.b64encode(secrets.token_bytes(32)).decode(),'DB_PASSWORD':secrets.token_hex(32),'DB_ROOT_PASSWORD':secrets.token_hex(32),'BOOKSTACK_ADMIN_EMAIL':email,'BOOKSTACK_ADMIN_PASSWORD':secrets.token_urlsafe(24)}
        ef.write_text(''.join(k+'='+shlex.quote(v)+'\n' for k,v in values.items())); ef.chmod(0o600)
    values=env_read(ef); config(path)
    # Bootstrap without public routing so default credentials are never exposed.
    config(path,False) if not (path/'.initialized').exists() else None
    compose(path,'up','-d'); ready_internal(path)
    if not (path/'.initialized').exists():
        php(path,"$v=json_decode(stream_get_contents(STDIN),true); $u=BookStack\\Users\\Models\\User::where('email','admin@admin.com')->first(); if (!$u) {$u=BookStack\\Users\\Models\\User::where('email',$v['email'])->firstOrFail();} $u->email=$v['email']; $u->password=Illuminate\\Support\\Facades\\Hash::make($v['secret']); $u->save();",{'email':values['BOOKSTACK_ADMIN_EMAIL'],'secret':values['BOOKSTACK_ADMIN_PASSWORD']})
        (path/'.initialized').touch()
    config(path); compose(path,'up','-d'); public_ready(values['APP_URL'])
    print('RUNNING '+values['APP_URL'])

def sql(path,query):
    return compose(path,'exec','-T','db','sh','-c','MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb -ubookstack bookstack -N -B',data=query.encode()).decode().strip()

def backup(path):
    if b'bookstack' not in compose(path,'ps','--status','running','--services').splitlines():
        raise RuntimeError('Backup requires running tenant; suspended tenant remains stopped')
    dest=path/'backups'/time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()); dest.mkdir(parents=True)
    compose(path,'stop','bookstack')
    try:
        dump=compose(path,'exec','-T','db','sh','-c','MYSQL_PWD="$MARIADB_PASSWORD" exec mariadb-dump -ubookstack --single-transaction --routines --triggers bookstack')
        (dest/'database.sql').write_bytes(dump)
        (dest/'pages.count').write_text(sql(path,"SELECT COUNT(*) FROM entities WHERE type='page';"))
        run(['sudo','-n','tar','-czf',str(dest/'bookstack.tar.gz'),'-C',str(path),'bookstack'])
        shutil.copy2(path/'.env',dest/'.env'); shutil.copy2(path/'docker-compose.yml',dest/'docker-compose.yml')
        (dest/'.complete').touch()
    finally: compose(path,'start','bookstack')
    complete=sorted(p for p in (path/'backups').iterdir() if (p/'.complete').exists())
    for old in complete[:-7]: run(['sudo','-n','rm','-rf','--',str(old)])
    print('BACKUP '+str(dest))

def restore(path):
    choices=sorted(p for p in (path/'backups').iterdir() if (p/'.complete').exists())
    if not choices: raise ValueError('No complete backup')
    src=choices[-1]; tmp=ROOT/('restore-'+path.name+'-'+secrets.token_hex(4)); tmp.mkdir()
    try:
        shutil.copy2(src/'.env',tmp/'.env'); config(tmp,False)
        run(['sudo','-n','tar','-xzf',str(src/'bookstack.tar.gz'),'-C',str(tmp)])
        compose(tmp,'up','-d','--wait','db')
        sql(tmp,(src/'database.sql').read_text())
        actual=sql(tmp,"SELECT COUNT(*) FROM entities WHERE type='page';"); expected=(src/'pages.count').read_text()
        if actual!=expected: raise RuntimeError('Restored page count mismatch')
        compose(tmp,'up','-d'); ready_internal(tmp)
        print('RESTORE OK pages='+actual)
    finally:
        compose(tmp,'down','--remove-orphans'); run(['sudo','-n','rm','-rf','--',str(tmp)])

def main():
    action=sys.argv[1]; slug=sys.argv[2]
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?',slug) or slug in {'www','mail','api','admin','restore'} or slug.startswith('restore-'): raise ValueError('Invalid or reserved slug')
    ROOT.mkdir(parents=True,exist_ok=True); path=ROOT/slug
    if path.is_symlink(): raise ValueError('Symlink tenant refused')
    if action=='provision': path.mkdir(mode=0o700,exist_ok=True)
    if not path.is_dir(): raise ValueError('Unknown tenant')
    locks=ROOT/'.locks'; locks.mkdir(exist_ok=True)
    with (locks/(slug+'.lock')).open('w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if action=='provision': provision(path,sys.argv[3] if len(sys.argv)>3 else 'admin@'+slug+'.wissen.app.mintapis.com')
        elif action=='deprovision': compose(path,'down')
        elif action=='destroy':
            if sys.argv[3:]!=['--yes']: raise ValueError('Destruction requires --yes')
            compose(path,'down'); run(['sudo','-n','rm','-rf','--',str(path)]); print('DESTROYED '+slug)
        elif action=='backup': backup(path)
        elif action=='restore-test': restore(path)
        else: raise ValueError('Unknown action')
if __name__=='__main__':
    try: main()
    except Exception as exc:
        print('ERROR '+str(exc) if isinstance(exc,(RuntimeError,ValueError)) else 'ERROR operation failed; inspect tenant locally',file=sys.stderr); sys.exit(1)
