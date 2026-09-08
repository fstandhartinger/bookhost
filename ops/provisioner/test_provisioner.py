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
