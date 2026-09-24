import contextlib
import hashlib
import hmac
import io
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import offsite

R2_ACCOUNT = 'a'*32
R2_ENDPOINT = 'https://'+R2_ACCOUNT+'.r2.cloudflarestorage.com'
R2_ENV = '\n'.join(['R2_ACCOUNT_ID='+R2_ACCOUNT,
                    'R2_ACCESS_KEY_ID=test-only',
                    'R2_SECRET_ACCESS_KEY=test-only-secret',
                    'R2_BUCKET=fixture-bucket',
                    'R2_ENDPOINT='+R2_ENDPOINT])+'\n'
KEY = b'test-only-key'


class FakeS3:
    def __init__(self): self.objects = {}
    def put_object(self, Bucket, Key, Body): self.objects[Key] = Body
    def upload_file(self, Filename, Bucket, Key): self.objects[Key] = Path(Filename).read_bytes()
    def download_file(self, Bucket, Key, Filename): Path(Filename).write_bytes(self.objects[Key])
    def delete_object(self, Bucket, Key): self.objects.pop(Key, None)
    def get_paginator(self, name):
        assert name == 'list_objects_v2'
        objects = self.objects
        class Paginator:
            def paginate(self, Bucket, Prefix='', Delimiter=None):
                contents, prefixes = [], set()
                for key in sorted(objects):
                    if not key.startswith(Prefix): continue
                    rest = key[len(Prefix):]
                    if Delimiter and Delimiter in rest:
                        prefixes.add(Prefix+rest.split(Delimiter)[0]+Delimiter)
                    elif rest:
                        contents.append({'Key': key})
                page = {'Contents': contents}
                if prefixes: page['CommonPrefixes'] = [{'Prefix': p} for p in sorted(prefixes)]
                return [page]
        return Paginator()


def fixture(tmp):
    # Tenant 'demo' with one authenticated pair plus junk that must never upload.
    root = Path(tmp)/'tenants'; work = Path(tmp)/'work'; work.mkdir()
    (work/'.r2.env').write_text(R2_ENV)
    backups = root/'demo'/'backups'; backups.mkdir(parents=True)
    key = Path(tmp)/'key'; key.write_bytes(KEY)
    name = '20260908T000000Z.age'
    (backups/name).write_bytes(b'encrypted')
    (backups/(name+'.hmac')).write_text(hmac.new(KEY,b'encrypted',hashlib.sha256).hexdigest())
    (backups/'.env').write_text('SECRET=test-fixture')
    (backups/'20260908T010000Z.age').write_bytes(b'incomplete')
    return root, key, name, work


def synced(fake, work, root, key, name):
    with patch.object(offsite,'WORK',work), patch.object(offsite.tenant,'ROOT',root), \
         patch.object(offsite.tenant,'KEY',key), \
         patch.object(offsite.time,'time',return_value=offsite.stamp(name)), contextlib.redirect_stdout(io.StringIO()):
        storage = offsite.R2Storage(client=fake)
        offsite.sync(storage)
    return storage


class OffsiteTests(unittest.TestCase):
    def test_authentication_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            key=Path(tmp)/'key'; key.write_bytes(KEY)
            src=Path(tmp)/'snapshot.age'; src.write_bytes(b'encrypted fixture')
            Path(str(src)+'.hmac').write_text(hmac.new(key.read_bytes(),src.read_bytes(),hashlib.sha256).hexdigest())
            with patch.object(offsite.tenant,'KEY',key):
                offsite.authenticate(src)
                src.write_bytes(b'corrupted')
                with self.assertRaisesRegex(ValueError,'authentication'):
                    offsite.authenticate(src)

    def test_retention_handles_orphans_and_preserves_unknown_files(self):
        class Fake:
            deleted=[]
            def names(self,slug=None):
                return ['20260801T000000Z.age','20260801T000000Z.age.hmac',
                        '20260802T000000Z.age.hmac','20260908T000000Z.age',
                        '.env','docker-compose.yml','../../outside.age']
            def delete(self,slug,name): self.deleted.append(name)
        remote=Fake()
        offsite.prune(remote,'demo',offsite.stamp('20260908T000000Z.age'))
        self.assertEqual(remote.deleted,['20260801T000000Z.age',
                                        '20260801T000000Z.age.hmac',
                                        '20260802T000000Z.age.hmac'])

    def test_sync_only_authenticated_encrypted_pairs(self):
        class Fake:
            uploaded=[]
            def names(self,slug=None): return []
            def upload(self,stage,slug): self.uploaded.extend(p.name for p in stage.iterdir())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); backups=root/'demo'/'backups'; backups.mkdir(parents=True)
            key=root/'key'; key.write_bytes(KEY)
            name='20260908T000000Z.age'
            (backups/name).write_bytes(b'encrypted')
            (backups/(name+'.hmac')).write_text(hmac.new(KEY,b'encrypted',hashlib.sha256).hexdigest())
            (backups/'.env').write_text('SECRET=test-fixture')
            (backups/'20260908T010000Z.age').write_bytes(b'incomplete')
            remote=Fake()
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.time,'time',return_value=offsite.stamp(name)),contextlib.redirect_stdout(io.StringIO()):
                offsite.sync(remote)
            self.assertEqual(sorted(remote.uploaded),[name,name+'.hmac'])

    def test_restore_selects_latest_complete_remote_pair(self):
        class Fake:
            def names(self,slug=None):
                return ['20260901T000000Z.age','20260901T000000Z.age.hmac',
                        '20260908T000000Z.age','20260908T000000Z.age.hmac',
                        '20260909T000000Z.age']
            def download(self,slug,name,dest):
                if name.endswith('.hmac'):
                    (dest/name).write_text(hmac.new(KEY,b'encrypted',hashlib.sha256).hexdigest())
                else:
                    (dest/name).write_bytes(b'encrypted')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); key=root/'key'; key.write_bytes(KEY)
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.tenant,'restore') as restore:
                offsite.restore(Fake(),'demo')
                self.assertEqual(restore.call_args.kwargs['src'].name,'20260908T000000Z.age')
            self.assertEqual(list(root.iterdir()),[key])

    def test_r2_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            fake = FakeS3()
            storage = synced(fake,work,root,key,name)
            self.assertEqual(sorted(fake.objects),['wissen-backups/demo/'+name,
                                                   'wissen-backups/demo/'+name+'.hmac'])
            self.assertEqual(storage.names(),['demo'])
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.tenant,'restore') as restore:
                offsite.restore(storage,'demo')
                self.assertEqual(restore.call_args.kwargs['src'].name,name)  # HMAC passed on the downloaded copy
            self.assertEqual(fake.objects['wissen-backups/demo/'+name],b'encrypted')

    def test_r2_restore_rejects_tampered_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            fake = FakeS3()
            storage = synced(fake,work,root,key,name)
            fake.objects['wissen-backups/demo/'+name] = b'tampered'
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.tenant,'restore') as restore:
                with self.assertRaisesRegex(ValueError,'authentication'):
                    offsite.restore(storage,'demo')
                restore.assert_not_called()

    def test_r2_config_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            with patch.object(offsite,'WORK',work):
                with self.assertRaises(ValueError): offsite.R2Storage()
                env = work/'.r2.env'
                env.write_text(R2_ENV); env.chmod(0o644)
                with self.assertRaises(ValueError): offsite.R2Storage()
                env.chmod(0o600)
                env.write_text(R2_ENV.replace('R2_BUCKET=fixture-bucket\n',''))
                with self.assertRaises(ValueError): offsite.R2Storage()
                env.write_text(R2_ENV.replace(R2_ENDPOINT,'https://evil.example.com'))
                with self.assertRaises(ValueError): offsite.R2Storage()

    def test_r2_error_hygiene(self):
        class Exploding:
            def get_paginator(self,name): raise Exception('AKIA-test-only-secret')
        with tempfile.TemporaryDirectory() as tmp, patch.object(offsite,'WORK',Path(tmp)):
            (Path(tmp)/'.r2.env').write_text(R2_ENV)
            storage = offsite.R2Storage(client=Exploding())
            with self.assertRaises(RuntimeError) as failure:
                storage.names()
            self.assertIn('R2 operation failed',str(failure.exception))
            self.assertNotIn('test-only-secret',str(failure.exception))

    def test_storage_backend_selection(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(offsite,'WORK',Path(tmp)):
            with patch.object(offsite,'StorageBox') as box:
                self.assertIs(offsite.storage(),box.return_value)
            (Path(tmp)/'.r2.env').write_text(R2_ENV)  # umask 077 gives mode 0600
            self.assertIsInstance(offsite.storage(),offsite.R2Storage)

    def test_r2_verify_ok(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            storage = synced(FakeS3(),work,root,key,name)
            out = io.StringIO()
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),contextlib.redirect_stdout(out):
                offsite.verify(storage,'demo')
            line = out.getvalue().strip()
            self.assertRegex(line,r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z OFFSITE VERIFY OK')
            self.assertIn('slug=demo',line)
            self.assertIn('archive='+name,line)
            self.assertIn('bytes=9',line)
            self.assertEqual([p.name for p in root.iterdir() if p.name.startswith('.offsite')],[])

    def fake_boto3(self, fake):
        module = types.ModuleType('boto3')
        module.client = lambda *args,**kwargs: fake
        return module

    def test_main_sync_line_is_timestamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            fake = FakeS3()
            synced(fake,work,root,key,name)
            out = io.StringIO()
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key), \
                 patch.object(offsite,'WORK',work),patch.object(offsite.time,'time',return_value=offsite.stamp(name)), \
                 patch.dict(sys.modules,{'boto3':self.fake_boto3(fake)}),patch.object(sys,'argv',['offsite.py','sync']), \
                 contextlib.redirect_stdout(out):
                offsite.main()
            self.assertRegex(out.getvalue().strip(),r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z OFFSITE SYNC OK archives=\d+')

    def test_main_verify_line_is_timestamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            fake = FakeS3()
            synced(fake,work,root,key,name)
            out = io.StringIO()
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key), \
                 patch.object(offsite,'WORK',work), \
                 patch.dict(sys.modules,{'boto3':self.fake_boto3(fake)}),patch.object(sys,'argv',['offsite.py','verify','demo']), \
                 contextlib.redirect_stdout(out):
                offsite.main()
            self.assertRegex(out.getvalue().strip(),r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z OFFSITE VERIFY OK slug=demo archive='+name)

    def test_main_error_line_is_timestamped(self):
        with tempfile.TemporaryDirectory() as tmp:
            root,key,name,work = fixture(tmp)
            err = io.StringIO()
            # env_read is patched so the runpy-executed entry never reads real config
            # content; an invalid invocation still exercises the __main__ error path.
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'env_read',return_value={}), \
                 patch.object(sys,'argv',['offsite.py','bogus']),contextlib.redirect_stderr(err):
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(Path(__file__).with_name('offsite.py')),run_name='__main__')
            self.assertRegex(err.getvalue().strip(),r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z OFFSITE ERROR')


if __name__=='__main__': unittest.main()
