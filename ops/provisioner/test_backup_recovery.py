import contextlib, io, pathlib, tempfile, unittest
from unittest.mock import patch
import tenant

class RecoveryTests(unittest.TestCase):
    def exercise(self, fail_start=False, fail_probe=False):
        with tempfile.TemporaryDirectory() as d, contextlib.ExitStack() as stack:
            p=pathlib.Path(d)/'fixture'; p.mkdir()
            (p/'.env').write_text('APP_URL=http://isolated.invalid\n')
            (p/'docker-compose.yml').write_text('{}')
            (p/'key').write_bytes(b'fixture-key')
            calls=[]
            def compose(path,*args,**kw):
                calls.append(args)
                if args[0]=='ps': return b'bookstack\n'
                if args==('start','bookstack') and fail_start: raise RuntimeError('start failed')
                return b'dump'
            def probe(path):
                calls.append(('probe',))
                if fail_probe: raise RuntimeError('HTTP unavailable')
                return {'login':'200 BookStack'}
            for name,value in [('compose',compose),('run',lambda *a,**kw: None),('retention',lambda p:None),('ensure_key',lambda:None),('content',lambda p:{}),('fingerprint',lambda p:{'content':{'uploads':[]}}),('archive_upload_hashes',lambda p:[]),('uploads_match',lambda *a:False),('crypt',lambda src,dst:dst.write_bytes(b'archive')),('service_recovered',probe)]:
                stack.enter_context(patch.object(tenant,name,side_effect=value,create=True))
            stack.enter_context(patch.object(tenant,'KEY',p/'key'))
            out=stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            err=stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            error=None
            try: tenant.backup(p,nightly=True)
            except RuntimeError as exc: error=exc
            archives=list((p/'backups').glob('*.age'))+list((p/'backups').glob('*.enc'))
            self.assertEqual(len(archives),1)
            self.assertTrue(archives[0].with_suffix(archives[0].suffix+'.hmac').exists())
            return error,out.getvalue(),err.getvalue(),calls
    def test_fallback_restart_failure_propagates_preserving_receipt(self):
        error,out,err,calls=self.exercise(fail_start=True)
        self.assertIsNotNone(error,'cold fallback swallowed compose-start failure')
        self.assertIn('BACKUP ARCHIVE cold ',out)
        self.assertNotIn('BACKUP cold ',out)
        self.assertIn('BACKUP ERROR recovery ',err)
    def test_start_success_requires_http_recovery(self):
        error,out,err,calls=self.exercise(fail_probe=True)
        self.assertIsNotNone(error)
        self.assertIn(('probe',),calls)
        self.assertNotIn('BACKUP cold ',out)
    def test_readonly_probe_uses_running_state_and_local_login(self):
        with patch.object(tenant,'compose',side_effect=[b'bookstack\n',b'<form action="/login"><input name="_token"></form>']) as compose,patch.object(tenant,'sql',side_effect=AssertionError('recovery must not change DB')):
            tenant.service_recovered(pathlib.Path('/fixture'))
        self.assertEqual(compose.call_count,2)
        self.assertIn('http://127.0.0.1/login',compose.call_args.args)
        self.assertIn('--max-time',compose.call_args.args)
    def test_probe_fails_on_stopped_app_without_sql(self):
        with patch.object(tenant,'compose',return_value=b''),patch.object(tenant.time,'monotonic',side_effect=[0,61]),patch.object(tenant,'sql',side_effect=AssertionError('DB forbidden')):
            with self.assertRaisesRegex(RuntimeError,'not running'):tenant.service_recovered(pathlib.Path('/fixture'))
    def test_success_after_recovery(self):
        error,out,err,calls=self.exercise()
        self.assertIsNone(error)
        self.assertIn(('probe',),calls)
        self.assertIn('BACKUP cold ',out)

if __name__=='__main__': unittest.main()
