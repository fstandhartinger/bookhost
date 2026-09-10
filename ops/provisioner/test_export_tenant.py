import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import tenant

spec = importlib.util.spec_from_file_location('export_tenant', Path(__file__).with_name('export-tenant.py'))
ex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ex)

COUNTS = {'books': 3, 'chapters': 7, 'pages': 42, 'attachments': 5, 'images': 9, 'users': 4}
DUMP = b'-- BookStack dump\nSELECT 1;\n'
IMAGE = 'lscr.io/linuxserver/bookstack:v99.0-ls1'
SECRET = b'TOTALLY-SECRET-XYZ'


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root/'acme-ltd'
        self.out = self.root/'export-out'
        self.make_tenant()
        patch.object(tenant, 'ROOT', self.root).start()
        self.compose = patch.object(tenant, 'compose', side_effect=self.fake_compose).start()
        self.sql = patch.object(tenant, 'sql', side_effect=self.fake_sql).start()
        self.run = patch.object(tenant, 'run', side_effect=self.fake_run).start()
        self.addCleanup(patch.stopall)

    def make_tenant(self):
        p = self.path
        (p/'bookstack/www/uploads/images').mkdir(parents=True)
        (p/'bookstack/www/uploads/images/logo.png').write_bytes(b'png-data')
        (p/'bookstack/www/files').mkdir()
        (p/'bookstack/www/files/manual.pdf').write_bytes(b'pdf-data')
        (p/'.initialized').touch()
        (p/'.env').write_text('APP_URL=https://acme.example\nDB_PASSWORD='+SECRET.decode()+'\n')
        (p/'docker-compose.yml').write_text(json.dumps({'services': {'bookstack': {'image': IMAGE}, 'db': {}}}))

    def make_backups(self):
        backups = self.path/'backups'; backups.mkdir()
        for name in ('20260901T000000Z.age', '20260902T000000Z.enc'):
            (backups/name).write_bytes(b'archive-'+name.encode())
            (backups/(name+'.hmac')).write_text('tag')
        (backups/'20260903T000000Z.age').write_bytes(b'orphan-without-hmac')
        (backups/'note.txt').write_text('x')

    def fake_compose(self, path, *args, data=None):
        if 'mariadb-dump' in ' '.join(map(str, args)): return DUMP
        return b''

    def fake_sql(self, path, query):
        for kind in ('book', 'chapter', 'page'):
            if "type='"+kind+"'" in query: return str(COUNTS[kind+'s'])
        for table in ('attachments', 'images', 'users'):
            if 'FROM '+table in query: return str(COUNTS[table])
        raise AssertionError('unexpected query: '+query)

    def fake_run(self, args, data=None):
        args = list(map(str, args))
        target = Path(args[args.index('-czf')+1])
        base = Path(args[args.index('-C')+1])
        transform = '--transform' in args
        with tarfile.open(target, 'w:gz') as tar:
            for name in args:
                if name.startswith('bookstack/'):
                    arc = name.replace('bookstack/www/files', 'bookstack/files') if transform else name
                    tar.add(base/name, arcname=arc)
        return b''

    def make_existing_export(self, slug='acme-ltd'):
        self.out.mkdir(parents=True, exist_ok=True)
        (self.out/'bookstack.sql').write_bytes(b'ORIGINAL-DUMP')
        (self.out/'storage.tar.gz').write_bytes(b'ORIGINAL-STORAGE')
        (self.out/'backups').mkdir()
        (self.out/'backups'/'20260101T000000Z.age').write_bytes(b'ORIGINAL-ARCHIVE')
        (self.out/'backups'/'20260101T000000Z.age.hmac').write_text('original-tag')
        manifest = {'tool': 'bookhost-export-tenant', 'format': 1, 'slug': slug,
                    'backups': ['20260101T000000Z.age']}
        (self.out/'MANIFEST.json').write_text(json.dumps(manifest))

    def snapshot_out(self):
        return {str(p.relative_to(self.out)): p.read_bytes()
                for p in sorted(self.out.rglob('*')) if p.is_file() and not p.is_symlink()}

    def go(self, out=None, **kwargs):
        return ex.export_tenant('acme-ltd', out or self.out, **kwargs)

    def manifest(self, out=None):
        return json.loads(((out or self.out)/'MANIFEST.json').read_text())

    def test_export_creates_dump_storage_and_manifest(self):
        result = self.go()
        dump = self.out/'bookstack.sql'; storage = self.out/'storage.tar.gz'
        for file in (dump, storage, self.out/'MANIFEST.json'):
            self.assertTrue(file.is_file(), file)
        self.assertEqual(dump.read_bytes(), DUMP)
        calls = [' '.join(map(str, call.args[1:])) for call in self.compose.call_args_list]
        dump_call = next(c for c in calls if 'mariadb-dump' in c)
        for expected in ('exec -T db', '--single-transaction', '--routines', '--triggers'):
            self.assertIn(expected, dump_call)
        with tarfile.open(storage) as tar:
            members = {m.name: m for m in tar.getmembers()}
        self.assertIn('bookstack/www/uploads/images/logo.png', members)
        self.assertIn('bookstack/files/manual.pdf', members)
        self.assertFalse(any(m.issym() or m.islnk() for m in members.values()))
        self.assertFalse(any(m.name.startswith('/') or '..' in m.name.split('/') for m in members.values()))
        manifest = self.manifest()
        self.assertEqual(manifest['slug'], 'acme-ltd')
        self.assertEqual(manifest['counts'], COUNTS)
        self.assertEqual(manifest['bookstack_image'], IMAGE)
        self.assertEqual(manifest['bookstack_version'], 'v99.0-ls1')
        self.assertRegex(manifest['exported_at'], r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
        for name in ('bookstack.sql', 'storage.tar.gz'):
            file = self.out/name
            self.assertEqual(manifest[name]['bytes'], file.stat().st_size)
            self.assertEqual(manifest[name]['sha256'], hashlib.sha256(file.read_bytes()).hexdigest())
        self.assertIn('any BookStack', manifest['restore'])
        self.assertIn('import-bookstack.py', manifest['restore'])
        self.assertNotIn('backups', manifest)
        blob = dump.read_bytes() + storage.read_bytes() + (self.out/'MANIFEST.json').read_bytes()
        self.assertNotIn(SECRET, blob)
        self.assertEqual([p for p in self.out.rglob('*') if p.name == '.env'], [])
        self.assertEqual(result['slug'], 'acme-ltd')
        self.assertEqual(result['counts'], COUNTS)
        self.assertNotIn('backups', result)

    def test_canonical_files_layout_skips_symlink(self):
        shutil.rmtree(self.path/'bookstack/www/files')
        (self.path/'bookstack/files').mkdir()
        (self.path/'bookstack/files/manual.pdf').write_bytes(b'pdf-data')
        (self.path/'bookstack/www/files').symlink_to('../files')
        self.go()
        with tarfile.open(self.out/'storage.tar.gz') as tar:
            members = {m.name: m for m in tar.getmembers()}
        self.assertIn('bookstack/files/manual.pdf', members)
        self.assertNotIn('bookstack/www/files', members)
        self.assertFalse(any(m.issym() or m.islnk() for m in members.values()))

    def test_image_version_optional(self):
        (self.path/'docker-compose.yml').write_text(json.dumps({'services': {}}))
        self.go()
        manifest = self.manifest()
        self.assertIsNone(manifest['bookstack_image'])
        self.assertIsNone(manifest['bookstack_version'])

    def test_invalid_slug_missing_and_uninitialized_tenant_abort(self):
        with self.assertRaisesRegex(ValueError, 'Invalid or reserved'):
            ex.export_tenant('BAD SLUG', self.out)
        with self.assertRaisesRegex(ValueError, 'Invalid or reserved'):
            ex.export_tenant('also--bad', self.out)
        with self.assertRaisesRegex(ValueError, 'does not exist'):
            ex.export_tenant('ghost-tenant', self.out)
        (self.root/'bare-tenant').mkdir()
        with self.assertRaisesRegex(ValueError, 'not initialized'):
            ex.export_tenant('bare-tenant', self.out)
        self.assertFalse(self.out.exists())

    def test_include_backups_copies_archives_without_keys(self):
        self.make_backups()
        result = self.go(include_backups=True)
        dest = self.out/'backups'
        self.assertEqual(sorted(p.name for p in dest.iterdir()),
                         ['20260901T000000Z.age', '20260901T000000Z.age.hmac',
                          '20260902T000000Z.enc', '20260902T000000Z.enc.hmac'])
        self.assertEqual((dest/'20260901T000000Z.age').read_bytes(), b'archive-20260901T000000Z.age')
        manifest = self.manifest()
        self.assertEqual(manifest['backups'], ['20260901T000000Z.age', '20260902T000000Z.enc'])
        self.assertEqual(result['backups'], 2)
        self.assertNotIn('.backup.key', ' '.join(p.name for p in self.out.rglob('*')))
        plain = self.root/'out-plain'
        ex.export_tenant('acme-ltd', plain)
        self.assertFalse((plain/'backups').exists())
        self.assertNotIn('backups', self.manifest(plain))

    def test_foreign_slug_manifest_never_overwritten(self):
        # An export of a different tenant already lives in the output directory:
        # exporting acme-ltd there must abort, never replace the foreign export.
        self.make_existing_export(slug='other-tenant')
        before = self.snapshot_out()
        error = None
        try:
            self.go()
        except (ValueError, OSError) as exc:
            error = exc
        self.assertEqual(self.snapshot_out(), before)
        self.assertIsInstance(error, ValueError)
        self.assertIn('different tenant', str(error))
        self.compose.assert_not_called()
        self.run.assert_not_called()

    def test_existing_backups_export_stays_untouched_without_overwrite(self):
        # Old export with a non-empty backups dir: without an explicit overwrite
        # the run must fail cleanly and leave every old byte in place (today
        # os.replace errors on the directory after the old files are lost).
        self.make_backups()
        self.make_existing_export(slug='acme-ltd')
        before = self.snapshot_out()
        error = None
        try:
            self.go(include_backups=True)
        except (ValueError, OSError) as exc:
            error = exc
        self.assertEqual(self.snapshot_out(), before)
        self.assertIsInstance(error, ValueError)
        self.assertIn('overwrite', str(error))
        self.compose.assert_not_called()
        self.run.assert_not_called()
        self.assertEqual(sorted(p.name for p in (self.out/'backups').iterdir()),
                         ['20260101T000000Z.age', '20260101T000000Z.age.hmac'])

    def test_empty_target_runs_with_and_without_overwrite(self):
        first = self.root/'fresh-one'
        ex.export_tenant('acme-ltd', first)
        self.assertTrue((first/'MANIFEST.json').is_file())
        second = self.root/'fresh-two'
        ex.export_tenant('acme-ltd', second, overwrite=True)
        self.assertEqual((second/'bookstack.sql').read_bytes(), DUMP)

    def test_each_existing_artifact_blocks_export(self):
        for name in ex.ARTIFACTS:
            with self.subTest(name=name):
                out = self.root/('only-' + name)
                out.mkdir()
                artifact = out/name
                if name == 'MANIFEST.json':
                    artifact.write_text(json.dumps({'slug': 'acme-ltd'}))
                elif name == 'backups':
                    artifact.mkdir()
                else:
                    artifact.write_bytes(b'keep')
                with self.assertRaisesRegex(ValueError, 'overwrite'):
                    self.go(out=out)
                self.assertEqual(list(out.iterdir()), [artifact])
        self.compose.assert_not_called()
        self.run.assert_not_called()

    def test_failed_publication_cleans_only_new_artifacts(self):
        self.out.mkdir()
        keep = self.out/'operator-note.txt'
        keep.write_bytes(b'keep')
        real_replace = ex.os.replace

        def fail_on_manifest(source, target):
            if Path(target).name == 'MANIFEST.json':
                raise OSError('publication failed')
            return real_replace(source, target)

        self.make_backups()
        with patch.object(ex.os, 'replace', side_effect=fail_on_manifest):
            with self.assertRaisesRegex(OSError, 'publication failed'):
                self.go(include_backups=True)
        self.assertEqual(list(self.out.iterdir()), [keep])
        self.assertEqual(keep.read_bytes(), b'keep')

    def test_overwrite_replaces_existing_export_including_backups(self):
        self.make_backups()
        self.make_existing_export(slug='acme-ltd')
        result = self.go(include_backups=True, overwrite=True)
        self.assertEqual((self.out/'bookstack.sql').read_bytes(), DUMP)
        self.assertNotIn(b'ORIGINAL', (self.out/'storage.tar.gz').read_bytes())
        self.assertEqual(sorted(p.name for p in (self.out/'backups').iterdir()),
                         ['20260901T000000Z.age', '20260901T000000Z.age.hmac',
                          '20260902T000000Z.enc', '20260902T000000Z.enc.hmac'])
        self.assertEqual(result['backups'], 2)
        manifest = self.manifest()
        self.assertEqual(manifest['backups'], ['20260901T000000Z.age', '20260902T000000Z.enc'])
        self.assertEqual([p for p in self.out.glob('.export-*')], [])

    def test_foreign_slug_rejected_even_with_overwrite(self):
        self.make_existing_export(slug='other-tenant')
        before = self.snapshot_out()
        with self.assertRaisesRegex(ValueError, 'different tenant'):
            self.go(overwrite=True)
        self.assertEqual(self.snapshot_out(), before)

    def test_failed_overwrite_leaves_existing_export_untouched(self):
        # Cleanup may only remove entries created by this run, never the old export.
        self.make_existing_export(slug='acme-ltd')
        before = self.snapshot_out()
        self.compose.side_effect = RuntimeError('db gone')
        with self.assertRaisesRegex(RuntimeError, 'db gone'):
            self.go(overwrite=True)
        self.assertEqual(self.snapshot_out(), before)
        self.assertEqual([p for p in self.out.glob('.export-*')], [])

    def test_overwrite_unlinks_symlinked_backups_without_following(self):
        outside = self.root/'outside'; outside.mkdir()
        (outside/'keep.txt').write_text('precious')
        self.make_existing_export(slug='acme-ltd')
        shutil.rmtree(self.out/'backups')
        (self.out/'backups').symlink_to(outside, target_is_directory=True)
        self.make_backups()
        self.go(include_backups=True, overwrite=True)
        self.assertTrue((outside/'keep.txt').is_file())
        backups = self.out/'backups'
        self.assertTrue(backups.is_dir())
        self.assertFalse(backups.is_symlink())

    def test_cli_overwrite_flag(self):
        self.make_existing_export(slug='acme-ltd')
        argv = ['export-tenant.py', 'acme-ltd', '--out', str(self.out)]
        with patch('sys.argv', argv):
            with patch('sys.stderr', new_callable=io.StringIO) as err:
                self.assertEqual(ex.main(), 1)
        self.assertIn('overwrite', err.getvalue())
        self.assertEqual((self.out/'bookstack.sql').read_bytes(), b'ORIGINAL-DUMP')
        with patch('sys.argv', argv + ['--overwrite']):
            with patch('sys.stdout', new_callable=io.StringIO) as out:
                self.assertEqual(ex.main(), 0)
        self.assertIn('EXPORTED', out.getvalue())
        self.assertEqual((self.out/'bookstack.sql').read_bytes(), DUMP)

    def test_failed_dump_leaves_no_partial_result(self):
        self.compose.side_effect = RuntimeError('db gone')
        with self.assertRaisesRegex(RuntimeError, 'db gone'):
            self.go()
        self.assertEqual(list(self.out.iterdir()), [])
        with patch('sys.argv', ['export-tenant.py', 'acme-ltd', '--out', str(self.out)]):
            with patch('sys.stderr', new_callable=io.StringIO) as err:
                self.assertEqual(ex.main(), 1)
        self.assertIn('ERROR', err.getvalue())
        self.assertIn('db gone', err.getvalue())
        self.assertEqual(list(self.out.iterdir()), [])

    def test_output_must_be_writable_and_outside_tenant(self):
        blocked = self.root/'blocked'; blocked.mkdir(); blocked.chmod(0o555)
        try:
            with self.assertRaisesRegex(ValueError, 'not writable'):
                ex.export_tenant('acme-ltd', blocked)
        finally:
            blocked.chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'inside the tenant'):
            ex.export_tenant('acme-ltd', self.path/'nested')
        self.assertFalse((self.path/'nested').exists())
        file_out = self.root/'a-file'; file_out.touch()
        with self.assertRaisesRegex(ValueError, 'not a directory'):
            ex.export_tenant('acme-ltd', file_out)

    def test_cli_success_and_error_paths(self):
        self.make_backups()
        with patch('sys.argv', ['export-tenant.py', 'acme-ltd', '--out', str(self.out), '--include-backups']):
            with patch('sys.stdout', new_callable=io.StringIO) as out:
                self.assertEqual(ex.main(), 0)
        self.assertIn('EXPORTED', out.getvalue())
        self.assertIn('acme-ltd', out.getvalue())
        self.assertTrue((self.out/'MANIFEST.json').is_file())
        self.assertTrue((self.out/'backups').is_dir())
        with patch('sys.argv', ['export-tenant.py', 'BAD', '--out', str(self.root/'never')]):
            with patch('sys.stderr', new_callable=io.StringIO) as err:
                self.assertEqual(ex.main(), 1)
        self.assertIn('Invalid or reserved', err.getvalue())
        self.assertFalse((self.root/'never').exists())
        with patch('sys.argv', ['export-tenant.py', 'acme-ltd']):
            with self.assertRaises(SystemExit) as raised:
                ex.main()
            self.assertEqual(raised.exception.code, 1)


if __name__ == '__main__': unittest.main()
