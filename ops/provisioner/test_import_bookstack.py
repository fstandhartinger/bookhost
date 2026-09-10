import gzip
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import tenant

spec = importlib.util.spec_from_file_location('import_bookstack', Path(__file__).with_name('import-bookstack.py'))
im = importlib.util.module_from_spec(spec)
spec.loader.exec_module(im)

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'tmp-dst'
        self.path.mkdir()
        (self.root/'.locks').mkdir()
        (self.root/'.locks'/'tmp-dst.lock').touch()
        for name in ('.initialized', 'docker-compose.yml'):
            (self.path/name).touch()
        (self.path/'.env').write_text('APP_URL=https://new.example\n')
        self.dump = self.root/'dump.sql'
        self.dump.write_bytes(b'SELECT 1;')
        self.files = self.root/'files.tar.gz'
        with tarfile.open(self.files, 'w:gz') as tar:
            info = tarfile.TarInfo('uploads/images/test.png'); info.size=3
            tar.addfile(info, io.BytesIO(b'png'))
        self.events=[]
        for name, value in [('ROOT',self.root), ('counts',{}), ('check_starter',None),
                            ('backup', self.root/'backup.enc'), ('import_dump',None),
                            ('install_files',None), ('artisan',None), ('rewrite_links',2),
                            ('rollback',None), ('ensure_token',None), ('kms_key',b'x'*32)]:
            if name=='ROOT':
                p=patch.object(im.tenant,name,value)
            else:
                p=patch.object(im,name,side_effect=lambda *a,_n=name,_v=value,**k: (self.events.append(_n),_v)[1])
            setattr(self,'mock_'+name,p.start()); self.addCleanup(p.stop)
        self.compose=patch.object(im.tenant,'compose',return_value=b'bookstack\ndb\n').start()
        patch.object(im.tenant,'service_recovered').start()
        self.addCleanup(patch.stopall)
    def go(self, **kwargs):
        return im.import_bookstack('tmp-dst',self.dump,self.files,**kwargs)
    def test_nonempty(self):
        self.mock_check_starter.side_effect=ValueError('not empty')
        with self.assertRaisesRegex(ValueError,'not empty'): self.go()
        self.assertNotIn('backup',self.events)
    def test_missing_dump(self):
        self.dump.unlink()
        with self.assertRaises(ValueError): self.go()
        self.assertNotIn('backup',self.events)
    def test_stopped(self):
        self.compose.return_value=b'db\n'
        with self.assertRaisesRegex(ValueError,'running'): self.go()
    def test_order_and_token(self):
        self.go(old_url='https://old.example')
        self.assertLess(self.events.index('backup'),self.events.index('import_dump'))
        self.assertLess(self.events.index('import_dump'),self.events.index('install_files'))
        self.assertIn('ensure_token',self.events)
        self.assertIn('rewrite_links',self.events)
    def test_no_old_url(self):
        self.go()
        self.assertNotIn('rewrite_links',self.events)
    def test_dry_run(self):
        self.go(dry_run=True)
        self.assertEqual(self.events,['counts','check_starter','kms_key'])
        self.assertEqual(self.compose.call_count,1)
    def test_failure_rolls_back(self):
        self.mock_install_files.side_effect=RuntimeError('failure')
        with self.assertRaisesRegex(RuntimeError,'backup.enc'): self.go()
        self.assertIn('rollback',self.events)
    def test_plain_and_gzip(self):
        for compressed in (False,True):
            p=self.root/('input.sql.gz' if compressed else 'input.sql')
            p.write_bytes(gzip.compress(b'SELECT 1;') if compressed else b'SELECT 1;')
            with im.open_dump(p) as f: self.assertEqual(f.read(),b'SELECT 1;')
    def test_archive_traversal(self):
        with tarfile.open(self.files,'w:gz') as tar:
            info=tarfile.TarInfo('uploads/../../evil'); info.size=1
            tar.addfile(info,io.BytesIO(b'x'))
        with self.assertRaises(ValueError): self.go()
        self.assertNotIn('backup',self.events)
    def test_php_uid(self):
        with patch.object(tenant,'compose') as c:
            tenant.php(self.path,'echo 1;')
            self.assertIn('1000:1000',c.call_args.args)


class ImportDetailTests(unittest.TestCase):
    def test_artisan_uid(self):
        with patch.object(tenant,'compose') as c:
            im.artisan(Path('/tmp/test'),['migrate','--force'])
            self.assertEqual(c.call_args.args[1:],('exec','-T','-u','1000:1000','-w','/app/www','bookstack','php','artisan','migrate','--force'))
    def test_file_layouts(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'files.tar.gz'
            with tarfile.open(p,'w:gz') as tar:
                for name in ('./www/uploads/a.png','files/a.txt','bookstack/www/uploads/b.png'):
                    info=tarfile.TarInfo(name); info.size=1; tar.addfile(info,io.BytesIO(b'a'))
            self.assertEqual([v for k,v in im.archive_members(p)],['www/uploads/a.png','files/a.txt','www/uploads/b.png'])
    def test_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'files.tar.gz'
            with tarfile.open(p,'w:gz') as tar:
                info=tarfile.TarInfo('uploads/x'); info.type=tarfile.SYMTYPE; info.linkname='/etc/passwd'; tar.addfile(info)
            with self.assertRaises(ValueError): im.archive_members(p)
    def test_reinstall_preserves_existing_credentials_without_controlplane(self):
        import bookstack_api_token as token
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); path=root/'tmp-dst'; path.mkdir(); (path/'.initialized').touch()
            key=b'x'*32
            (path/'.env').write_text('BOOKSTACK_API_ID='+token.encrypt('old-id','tmp-dst',key)+'\nBOOKSTACK_API_SECRET='+token.encrypt('old-secret','tmp-dst',key)+'\n')
            with patch.object(token,'ROOT',root),patch.object(token,'kms_key',return_value=key),patch.object(token,'php',return_value=b'legacy') as php,patch.object(token,'api_valid') as api:
                ident,_=token.ensure_token('tmp-dst',reinstall=True,locked=True)
                self.assertEqual(ident,'old-id'); self.assertEqual(php.call_args.args[2]['secret'],'old-secret')
                api.assert_not_called()
                values=token.env_read(path/'.env')
                self.assertEqual(token.decrypt(values['BOOKSTACK_API_SECRET'],'tmp-dst',key),'old-secret')

class DumpExecutionTests(unittest.TestCase):
    def test_plain_and_gzip_reach_mariadb_identically(self):
        with tempfile.TemporaryDirectory() as d:
            for compressed in (False,True):
                source=Path(d)/('data.sql.gz' if compressed else 'data.sql')
                source.write_bytes(gzip.compress(b'SELECT 123;') if compressed else b'SELECT 123;')
                with patch.object(tenant,'sql',return_value='old_table\tBASE TABLE') as sql, patch.object(tenant,'compose') as compose:
                    im.import_dump(Path('/tmp/tenant'),source)
                    self.assertEqual(compose.call_args.kwargs['data'],b'SELECT 123;')
                    self.assertIn('DROP TABLE `old_table`',sql.call_args.args[1])

if __name__=='__main__': unittest.main()
