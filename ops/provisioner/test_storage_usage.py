import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

class StorageTests(unittest.TestCase):
    def test_real_directory_bytes_without_database_backups_or_symlinks(self):
        from storage_usage import upload_bytes
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name, data in [('bookstack/www/uploads/image', b'123'), ('bookstack/www/files/private', b'12345'), ('database/data', b'ignored'), ('backups/a', b'ignored')]:
                p = root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
            (root/'bookstack/www/uploads/link').symlink_to(root/'database', target_is_directory=True)
            self.assertEqual(upload_bytes(root), 8)
    def test_missing_workspace_is_unknown_not_zero(self):
        from storage_usage import upload_bytes
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(upload_bytes(Path(d)/'missing'))
    def test_persistence_is_scoped_to_worker_instance(self):
        from storage_usage import record_storage
        with tempfile.TemporaryDirectory() as d:
            db = MagicMock()
            record_storage(db, 'id', Path(d), 'acceptance')
            self.assertIn('provisioner_instance', db.execute.call_args.args[0])
            self.assertEqual(db.execute.call_args.args[1][-2:], ('acceptance', 'id'))
