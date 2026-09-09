import contextlib
import hashlib
import io
import json
import os
import shutil
import tarfile
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

    def test_restore_http_probe_checks_login_page_and_png(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'restore-fixture'; path.mkdir()
            calls=[]
            def fake_run(args, data=None):
                calls.append(args)
                if args[:3]==['sudo','-n','docker'] and args[3]=='inspect':
                    return b'{"wissen-fixture_private":{"IPAddress":"172.20.0.2"}}'
                if 'curlimages/curl:8.10.1' in args:
                    if any('/login' in item for item in args):
                        return b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<title>BookStack</title>'
                    if '-D' in args:
                        return b'HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n\r\n'
                    return b'<title>Fixture Page</title><h1>Fixture Page</h1>'
                return b'container-id'
            with patch.object(tenant,'sql',side_effect=['','42\tFixture Page\tfixture-page\tfixture-book','/uploads/images/fixture.png']), patch.object(tenant,'compose',return_value=b'container-id'), patch.object(tenant,'run',side_effect=fake_run):
                result=tenant.restore_http_probe(path)
            self.assertEqual(result,{'login':'200 BookStack','page':'200 Fixture Page','image':'200 image/png'})

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
            with patch.object(tenant,'compose'), patch.object(tenant,'ready_internal'), patch.object(tenant,'public_ready'), patch.object(tenant,'php'), patch.object(tenant,'seed_starter_book',side_effect=seeded) as seed, patch.object(tenant,'backup') as backup:
                tenant.provision(p,'valid@example.invalid')
                self.assertTrue((p/'.initialized').exists())
                tenant.provision(p,'valid@example.invalid')
                seed.assert_called_once_with(p,'valid@example.invalid')
                backup.assert_called_once_with(p, hot=True)

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

    def test_hot_backup_never_stops_and_marks_verified(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test-team'; (p/'backups').mkdir(parents=True)
            (p/'.env').write_text('APP_URL=https://example.invalid\n'); (p/'docker-compose.yml').write_text('{}')
            snapshot={'pages':'1','books':'1','uploads':[],'tables':{'attachments':{'count':'0','sha256':'x'},'images':{'count':'0','sha256':'y'}}}
            calls=[]
            def fake_compose(path,*args,**kwargs):
                calls.append(args)
                if args[:2]==('ps','--status'): return b'bookstack\n'
                if args[:2]==('exec','-T') and 'mariadb-dump' in args[-1]: return b'database'
                return b''
            def fake_run(args, data=None):
                if args[:2]==['sudo','-n'] and 'tar' in args: Path(args[args.index('-czf')+1]).write_bytes(b'tar')
                elif args[:2]==['tar','-cf']: Path(args[args.index('-cf')+1]).write_bytes(b'snapshot')
                return b''
            def fake_crypt(src,dst,*args,**kwargs): Path(dst).write_bytes(b'encrypted')
            with patch.object(tenant,'KEY',p/'key'), patch.object(tenant,'compose',side_effect=fake_compose), patch.object(tenant,'fingerprint',return_value={'content':snapshot}), patch.object(tenant,'archive_upload_hashes',return_value=[]), patch.object(tenant,'run',side_effect=fake_run), patch.object(tenant,'crypt',side_effect=fake_crypt):
                tenant.backup(p,hot=True)
            self.assertFalse(any(args[:2] in [('stop','bookstack'),('start','bookstack')] for args in calls))

    def test_hot_backup_inconsistency_retries_then_cleans_stage(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test-team'; (p/'backups').mkdir(parents=True)
            (p/'.env').write_text('x'); (p/'docker-compose.yml').write_text('{}')
            content=[{'content':{'v':1,'uploads':[]}},{'content':{'v':2,'uploads':[]}},{'content':{'v':3,'uploads':[]}},{'content':{'v':4,'uploads':[]}}]
            def fake_compose(path,*args,**kwargs):
                if args[:2]==('ps','--status'): return b'bookstack\n'
                if args[:2]==('exec','-T'): return b'dump'
                return b''
            def fake_run(args, data=None):
                if args[:3]==['sudo','-n','rm']:
                    shutil.rmtree(args[-1])
                return b''
            with patch.object(tenant,'KEY',p/'key'), patch.object(tenant,'compose',side_effect=fake_compose), patch.object(tenant,'fingerprint',side_effect=content), patch.object(tenant,'archive_upload_hashes',return_value=[]), patch.object(tenant,'run',side_effect=fake_run), patch.object(tenant,'crypt'):
                with self.assertRaisesRegex(RuntimeError,'hot-inconsistent'): tenant.backup(p,hot=True)
            self.assertEqual(list((p/'backups').iterdir()),[])

    def test_hot_backup_rejects_upload_changed_and_restored_during_tar(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test-team'; (p/'backups').mkdir(parents=True)
            uploads=p/'bookstack'/'www'/'uploads'; uploads.mkdir(parents=True)
            upload=uploads/'document.txt'; upload.write_bytes(b'before')
            (p/'.env').write_text('x'); (p/'docker-compose.yml').write_text('{}')
            stable={'pages':'1','books':'1','uploads':[{'path':'www/uploads/document.txt','bytes':6,'sha256':hashlib.sha256(b'before').hexdigest()}],'tables':{}}
            def fake_compose(path,*args,**kwargs):
                if args[:2]==('ps','--status'): return b'bookstack\n'
                if args[:2]==('exec','-T'): return b'dump'
                return b''
            def fake_run(args, data=None):
                if args[:3]==['sudo','-n','tar']:
                    archive=Path(args[args.index('-czf')+1])
                    upload.write_bytes(b'during')
                    with tarfile.open(archive,'w:gz') as out:
                        out.add(uploads,arcname='bookstack/www/uploads')
                    upload.write_bytes(b'before')
                elif args[:2]==['tar','-cf']:
                    outer=Path(args[args.index('-cf')+1])
                    with tarfile.open(outer,'w') as out:
                        for name in ('database.sql','content.json','bookstack.tar.gz','.env','docker-compose.yml'):
                            out.add(Path(args[args.index('-C')+1])/name,arcname=name)
                elif args[:3]==['sudo','-n','rm']:
                    shutil.rmtree(args[-1])
                return b''
            with patch.object(tenant,'KEY',p/'key'), patch.object(tenant,'compose',side_effect=fake_compose), patch.object(tenant,'content',return_value=stable), patch.object(tenant,'fingerprint',return_value={'content':stable}), patch.object(tenant,'run',side_effect=fake_run), patch.object(tenant,'crypt',side_effect=lambda src,dst,*a,**k: shutil.copy2(src,dst)):
                with self.assertRaisesRegex(RuntimeError,'hot-inconsistent'): tenant.backup(p,hot=True)
            self.assertEqual(list((p/'backups').iterdir()),[])

    def test_hot_backup_retries_when_page_content_changes_without_content_counters(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test-team'; (p/'backups').mkdir(parents=True)
            (p/'.env').write_text('x'); (p/'docker-compose.yml').write_text('{}')
            same={'content':{'pages':'1','books':'1','uploads':[],'tables':{}}}
            changed=dict(same, page_revisions={'count':'2','max_id':'9'})
            fingerprints=[same,changed,same,changed]
            def fake_compose(path,*args,**kwargs):
                if args[:2]==('ps','--status'): return b'bookstack\n'
                if args[:2]==('exec','-T'): return b'dump'
                return b''
            def fake_run(args, data=None):
                if args[:3]==['sudo','-n','rm']: shutil.rmtree(args[-1])
                return b''
            with patch.object(tenant,'KEY',p/'key'), patch.object(tenant,'compose',side_effect=fake_compose), patch.object(tenant,'fingerprint',side_effect=fingerprints), patch.object(tenant,'archive_upload_hashes',return_value=[]), patch.object(tenant,'run',side_effect=fake_run), patch.object(tenant,'crypt'):
                with self.assertRaisesRegex(RuntimeError,'hot-inconsistent'): tenant.backup(p,hot=True)
            self.assertEqual(list((p/'backups').iterdir()),[])

    def test_hot_backup_records_fingerprint_and_verified_tar(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test-team'; (p/'backups').mkdir(parents=True)
            uploads=p/'bookstack'/'www'/'uploads'; uploads.mkdir(parents=True)
            (uploads/'document.txt').write_bytes(b'stable')
            (p/'.env').write_text('x'); (p/'docker-compose.yml').write_text('{}')
            fp={'content':{'pages':'1','uploads':[{'path':'www/uploads/document.txt','bytes':6,'sha256':hashlib.sha256(b'stable').hexdigest()}]},'activities':{'count':'3','max_id':'7'},'page_revisions':{'count':'2','max_id':'4'},'entities':{'max_updated_at':'2026-01-01 00:00:00'},'attachments':{'max_updated_at':None},'images':{'max_updated_at':None}}
            def fake_compose(path,*args,**kwargs):
                if args[:2]==('ps','--status'): return b'bookstack\n'
                if args[:2]==('exec','-T'): return b'dump'
                return b''
            def fake_run(args, data=None):
                if args[:3]==['sudo','-n','tar']:
                    archive=Path(args[args.index('-czf')+1])
                    with tarfile.open(archive,'w:gz') as out: out.add(uploads,arcname='bookstack/www/uploads')
                elif args[:2]==['tar','-cf']:
                    outer=Path(args[args.index('-cf')+1]); stage=Path(args[args.index('-C')+1])
                    with tarfile.open(outer,'w') as out:
                        for name in ('database.sql','content.json','bookstack.tar.gz','.env','docker-compose.yml'): out.add(stage/name,arcname=name)
                elif args[:3]==['sudo','-n','rm']: shutil.rmtree(args[-1])
                return b''
            with patch.object(tenant,'KEY',p/'key'), patch.object(tenant,'compose',side_effect=fake_compose), patch.object(tenant,'fingerprint',return_value=fp), patch.object(tenant,'run',side_effect=fake_run), patch.object(tenant,'crypt',side_effect=lambda src,dst,*a,**k: shutil.copy2(src,dst)):
                tenant.backup(p,hot=True)
            archive=next(item for item in (p/'backups').iterdir() if item.suffix in {'.age','.enc'})
            with tarfile.open(archive) as outer:
                metadata=json.loads(outer.extractfile('content.json').read())
                self.assertEqual(metadata['consistency'],'verified')
                self.assertEqual(metadata['fingerprint'],fp)
                with tarfile.open(fileobj=outer.extractfile('bookstack.tar.gz'),mode='r:gz') as inner:
                    self.assertIn('bookstack/www/uploads/document.txt',inner.getnames())

if __name__=='__main__':unittest.main()


class HotUploadOrderTest(unittest.TestCase):
    def test_archive_and_live_upload_lists_compare_order_independently(self):
        import tenant
        live=[{'path':'www/uploads/a.png','bytes':1,'sha256':'aa'},{'path':'files/b.txt','bytes':2,'sha256':'bb'}]
        archived=[{'path':'files/b.txt','bytes':2,'sha256':'bb'},{'path':'www/uploads/a.png','bytes':1,'sha256':'aa'}]
        self.assertTrue(tenant.uploads_match(archived, live))
        self.assertFalse(tenant.uploads_match(archived[:1], live))
        self.assertFalse(tenant.uploads_match([{'path':'files/b.txt','bytes':2,'sha256':'zz'},live[0]], live))
