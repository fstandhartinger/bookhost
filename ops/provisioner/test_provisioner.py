import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import tenant
import worker

class LifecycleTests(unittest.TestCase):
    def test_network_contract_public_and_bootstrap(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'test-team';path.mkdir()
            for public in (False,True):
                tenant.config(path,public)
                cfg=json.loads((path/'docker-compose.yml').read_text())
                self.assertEqual(cfg['networks']['private'],{'name':'wissen-test-team-internal','internal':True})
                self.assertEqual(cfg['services']['db']['networks'],['private'])
                self.assertEqual(cfg['services']['db']['labels']['traefik.enable'],'false')
                self.assertEqual(cfg['services']['bookstack']['networks'],['private','coolify'] if public else ['private'])
                for service in cfg['services'].values():
                    self.assertNotIn('ports',service)
                    self.assertNotIn('cap_add',service)
                    self.assertFalse(service['privileged'])
                    self.assertIn('no-new-privileges:true',service['security_opt'])
                if public:
                    self.assertEqual(cfg['networks']['coolify'],{'external':True,'name':'coolify'})
                    self.assertEqual(cfg['services']['bookstack']['labels']['traefik.docker.network'],'coolify')

    def test_migration_preserves_config_and_rolls_back_failure(self):
        for fail in (False,True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as d:
                path=Path(d)/'test-team';path.mkdir();tenant.config(path)
                target=path/'docker-compose.yml';cfg=json.loads(target.read_text())
                cfg['services']['bookstack']['environment']['CUSTOM_SETTING']='keep-me'
                cfg['services']['bookstack']['image']='preserved-image'
                cfg['services']['db']['networks']=['coolify']
                cfg['services']['db']['ports']=['3306:3306']
                cfg['services']['bookstack']['cap_add']=['NET_ADMIN']
                target.write_text(json.dumps(cfg));original=target.read_bytes()
                (path/'.initialized').touch();(path/'.env').write_text('APP_URL=https://example.invalid\n')
                with patch.object(tenant,'run'),patch.object(tenant,'compose') as compose,patch.object(tenant,'content',return_value={'pages':'11'}),patch.object(tenant,'ready_internal',side_effect=RuntimeError('unhealthy') if fail else None),patch.object(tenant,'public_ready'):
                    if fail:
                        with self.assertRaisesRegex(RuntimeError,'unhealthy'):tenant.migrate_network(path)
                        self.assertEqual(target.read_bytes(),original)
                        self.assertEqual(compose.call_args.args,(path,'up','-d'))
                    else:
                        tenant.migrate_network(path);new=json.loads(target.read_text())
                        self.assertEqual(new['services']['bookstack']['image'],'preserved-image')
                        self.assertEqual(new['services']['bookstack']['environment'],cfg['services']['bookstack']['environment'])
                        self.assertEqual(new['services']['db']['networks'],['private'])
                        self.assertNotIn('ports',new['services']['db'])
                        self.assertNotIn('cap_add',new['services']['bookstack'])
                self.assertFalse((path/'.network-candidate.json').exists())

    def test_public_readiness_accepts_custom_branded_login(self):
        with patch.object(tenant.urllib.request,'urlopen') as request:
            response=request.return_value.__enter__.return_value
            response.status=200
            response.read.return_value=b'<form action="https://demo.example/login"><input name="_token"></form>'
            tenant.public_ready('https://demo.example')
            request.assert_called_once()

    def test_slug_contract(self):
        for slug in json.loads((tenant.HERE/'reserved-slugs.json').read_text())+['restore-x','restoreabc','ab','a--b','a'*31,'../foo','Foo','-foo','foo-']:
            self.assertFalse(tenant.valid_slug(slug),slug)
        for slug in ['abc','good-team','a'*30]: self.assertTrue(tenant.valid_slug(slug))

    def test_retention_is_age_based(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d); backups=path/'backups'; backups.mkdir()
            recent=[]
            for n in range(12):
                p=backups/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime(time.time()-n*60))+'.age');p.touch();recent.append(p)
            old=backups/(time.strftime('%Y%m%dT%H%M%SZ',time.gmtime(time.time()-8*86400))+'.age');old.touch()
            with patch.object(tenant,'run') as run:
                tenant.retention(path)
            self.assertEqual(run.call_count,1);self.assertEqual(run.call_args.args[0][-1],str(old))

    def test_purge_waits_30_days(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);marker=p/'.destroy_requested_at';marker.write_text(str(time.time()-29*86400))
            with patch.object(tenant,'compose') as compose,patch.object(tenant,'run') as run:
                tenant.purge(p); compose.assert_not_called();run.assert_not_called()
                marker.write_text(str(time.time()-31*86400));tenant.purge(p)
                compose.assert_called_once_with(p,'down','--remove-orphans');run.assert_called_once()

    def test_failed_provision_down_preserves_files(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'test-tenant';p.mkdir();(p/'docker-compose.yml').write_text('{}')
            with patch.object(tenant,'ROOT',root),patch.object(tenant,'provision',side_effect=RuntimeError('healthcheck')),patch.object(tenant,'compose') as compose,patch('sys.argv',['tenant.py','provision','test-tenant']):
                with self.assertRaises(RuntimeError):tenant.main()
                compose.assert_called_once_with(p,'down','--remove-orphans')
            self.assertTrue(p.exists())

    def test_resume_does_not_reseed_or_rewrite_config(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'.env').write_text('APP_URL=https://example.invalid\n');(p/'.initialized').touch();(p/'docker-compose.yml').write_text('{}')
            with patch.object(tenant,'compose') as compose,patch.object(tenant,'ready_internal'),patch.object(tenant,'public_ready'),patch.object(tenant,'php') as php,patch.object(tenant,'config') as config:
                tenant.provision(p,'valid@example.invalid');compose.assert_called_once_with(p,'up','-d');php.assert_not_called();config.assert_not_called()

    def test_fresh_tenant_seeds_before_initialization_and_resume_skips_seed(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            def seeded(path, email):
                self.assertEqual(email, 'valid@example.invalid')
                self.assertFalse((path/'.initialized').exists())
            with patch.object(tenant,'compose'), patch.object(tenant,'ready_internal'), patch.object(tenant,'public_ready'), patch.object(tenant,'php'), patch.object(tenant,'seed_starter_book',side_effect=seeded) as seed:
                tenant.provision(p,'valid@example.invalid')
                self.assertTrue((p/'.initialized').exists())
                tenant.provision(p,'valid@example.invalid')
                seed.assert_called_once_with(p,'valid@example.invalid')

    def test_failed_seed_does_not_mark_initialized(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with patch.object(tenant,'compose'), patch.object(tenant,'ready_internal'), patch.object(tenant,'php'), patch.object(tenant,'seed_starter_book',side_effect=RuntimeError('seed failed')):
                with self.assertRaisesRegex(RuntimeError,'seed failed'):
                    tenant.provision(p,'valid@example.invalid')
                self.assertFalse((p/'.initialized').exists())

    def test_capacity_disk_and_count_and_notice_throttle(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(worker,'ROOT',Path(d)),patch.object(worker.subprocess,'check_output',side_effect=['Avail\n100\n','wissen-demo-bookstack-1\n']*2),contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertFalse(worker.capacity()); self.assertFalse(worker.capacity())
            self.assertEqual(out.getvalue().count('Capacity:'),1)

    def test_openssl_fallback_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);src=p/'snapshot.tar';src.write_bytes(b'backup roundtrip fixture')
            with patch.object(tenant,'KEY',p/'key'),patch.object(tenant.shutil,'which',return_value=None):
                tenant.crypt(src,p/'snapshot.enc')
                tenant.crypt(p/'snapshot.enc',p/'restored.tar',True)
                self.assertEqual(src.read_bytes(),(p/'restored.tar').read_bytes())
                self.assertEqual((p/'key').stat().st_mode & 0o777,0o600)
                self.assertNotIn(src.read_bytes(),(p/'snapshot.enc').read_bytes())

    def test_backup_auth_rejects_corruption_before_restore(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);backups=p/'backups';backups.mkdir();key=p/'key';key.write_text('test-key')
            src=backups/'20260908T000000Z.age';src.write_bytes(b'changed');src.with_suffix('.age.hmac').write_text('0'*64)
            with patch.object(tenant,'KEY',key),patch.object(tenant,'crypt') as crypt:
                with self.assertRaisesRegex(ValueError,'authentication'):tenant.restore(p)
                crypt.assert_not_called()

if __name__=='__main__':unittest.main()
