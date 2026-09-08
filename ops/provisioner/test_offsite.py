import contextlib
import hashlib
import hmac
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import offsite


class OffsiteTests(unittest.TestCase):
    def test_authentication_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            key=Path(tmp)/'key'; key.write_bytes(b'test-only-key')
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
            def names(self,path):
                return ['20260801T000000Z.age','20260801T000000Z.age.hmac',
                        '20260802T000000Z.age.hmac','20260908T000000Z.age',
                        '.env','docker-compose.yml','../../outside.age']
            def remote(self,*args): self.deleted.append(args[-1])
        remote=Fake()
        offsite.prune(remote,'demo',offsite.stamp('20260908T000000Z.age'))
        self.assertEqual(remote.deleted,['wissen-backups/demo/20260801T000000Z.age',
                                        'wissen-backups/demo/20260801T000000Z.age.hmac',
                                        'wissen-backups/demo/20260802T000000Z.age.hmac'])

    def test_sync_only_authenticated_encrypted_pairs(self):
        class Fake:
            uploaded=[]
            def remote(self,*args): pass
            def names(self,path): return []
            def upload(self,stage,slug): self.uploaded.extend(p.name for p in stage.iterdir())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); backups=root/'demo'/'backups'; backups.mkdir(parents=True)
            key=root/'key'; key.write_bytes(b'test-only-key')
            name='20260908T000000Z.age'
            (backups/name).write_bytes(b'encrypted')
            (backups/(name+'.hmac')).write_text(hmac.new(key.read_bytes(),b'encrypted',hashlib.sha256).hexdigest())
            (backups/'.env').write_text('SECRET=test-fixture')
            (backups/'20260908T010000Z.age').write_bytes(b'incomplete')
            remote=Fake()
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.time,'time',return_value=offsite.stamp(name)),contextlib.redirect_stdout(io.StringIO()):
                offsite.sync(remote)
            self.assertEqual(sorted(remote.uploaded),[name,name+'.hmac'])

    def test_restore_selects_latest_complete_remote_pair(self):
        class Fake:
            ssh=['ssh']; target='fixture'
            def names(self,path):
                return ['20260901T000000Z.age','20260901T000000Z.age.hmac',
                        '20260908T000000Z.age','20260908T000000Z.age.hmac',
                        '20260909T000000Z.age']
            def download(self,slug,name,dest): (dest/name).write_bytes(b'encrypted')
            def command(self,args):
                Path(args[-1]).write_text(hmac.new(b'test-only-key',b'encrypted',hashlib.sha256).hexdigest())
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); key=root/'key'; key.write_bytes(b'test-only-key')
            with patch.object(offsite.tenant,'ROOT',root),patch.object(offsite.tenant,'KEY',key),patch.object(offsite.tenant,'restore') as restore:
                offsite.restore(Fake(),'demo')
                self.assertEqual(restore.call_args.kwargs['src'].name,'20260908T000000Z.age')
            self.assertEqual(list(root.iterdir()),[key])


if __name__=='__main__': unittest.main()
