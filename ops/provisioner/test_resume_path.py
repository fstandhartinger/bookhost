"""Offline lifecycle contract: no Docker, network or real DB is used."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import tenant
import worker


class ResumePathTests(unittest.TestCase):
    def reconcile(self, root, status, desired):
        db = MagicMock()
        def execute(sql, params=None):
            result = MagicMock()
            result.fetchall.return_value = [('id', 'customer-team', 'owner@example.invalid', status, desired, None)] if sql.startswith('SELECT id,slug,admin_email') else []
            result.fetchone.return_value = ('id',)
            return result
        db.execute.side_effect = execute
        with patch.object(worker.psycopg, 'connect') as connect, patch.object(worker, 'ROOT', root), patch.object(worker, 'env_read', return_value={'DATABASE_URL_LOCAL': 'mock', 'APP_URL': 'https://customer-team.bookhost.co'}), patch.object(worker, 'capacity', return_value=True), patch.object(worker, 'store_token'), patch.object(worker, 'command') as command:
            connect.return_value.__enter__.return_value = db
            worker.once()
        return db, command

    def fixture(self, root):
        path = root/'customer-team'; path.mkdir()
        for name in ('.initialized', 'docker-compose.yml', '.env', 'database', 'uploads'):
            (path/name).write_text('fixture')
        return path

    def test_suspend_and_paid_resume_keep_data_and_consumed_password(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); path = self.fixture(root)
            before = {p.name: p.read_bytes() for p in path.iterdir()}
            db, command = self.reconcile(root, 'running', 'suspended')
            command.assert_called_once_with('deprovision', 'customer-team')
            self.assertTrue(any("SET status='suspended'" in c.args[0] for c in db.execute.call_args_list))
            db, command = self.reconcile(root, 'suspended', 'running')
            self.assertEqual([c.args[0] for c in command.call_args_list], ['deprovision', 'provision'])
            self.assertTrue(any("SET status='running'" in c.args[0] for c in db.execute.call_args_list))
            self.assertFalse(any('initial_password=' in c.args[0] for c in db.execute.call_args_list))
            self.assertEqual(before, {p.name: p.read_bytes() for p in path.iterdir()})

    def test_deprovision_never_removes_data_or_volumes_or_marks_destroy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); path = self.fixture(root)
            with patch.object(tenant, 'ROOT', root), patch.object(tenant, 'compose') as compose, patch.object(tenant, 'run') as run, patch('sys.argv', ['tenant.py', 'deprovision', 'customer-team']):
                tenant.main()
            compose.assert_called_once_with(path, 'down'); run.assert_not_called()
            self.assertTrue((path/'database').exists()); self.assertTrue((path/'uploads').exists())
            self.assertFalse((path/'.destroy_requested_at').exists())

    def test_purge_requires_explicit_mark_and_full_30_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp); now = 2000000000
            with patch.object(tenant.time, 'time', return_value=now), patch.object(tenant, 'compose') as compose, patch.object(tenant, 'run') as run:
                tenant.purge(path)
                (path/'.destroy_requested_at').write_text(str(now-30*86400+1))
                tenant.purge(path); compose.assert_not_called(); run.assert_not_called()
                (path/'.destroy_requested_at').write_text(str(now-30*86400))
                tenant.purge(path); compose.assert_called_once(); run.assert_called_once()

    def test_missing_or_destroyed_workspace_fails_visibly_without_recreation(self):
        for kind in ('missing', 'marked', 'purged', 'missing-env', 'missing-compose', 'uninitialized'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                if kind in ('missing-env', 'missing-compose', 'uninitialized'):
                    path = self.fixture(root)
                    (path / {'missing-env': '.env', 'missing-compose': 'docker-compose.yml', 'uninitialized': '.initialized'}[kind]).unlink()
                if kind == 'marked':
                    path = self.fixture(root); (path/'.destroy_requested_at').write_text(str(time.time()))
                if kind == 'purged':
                    (root/'.destroy-requests').mkdir(); (root/'.destroy-requests'/'customer-team').touch()
                db, command = self.reconcile(root, 'suspended', 'running')
                self.assertFalse(any(c.args[0] == 'provision' for c in command.call_args_list))
                self.assertTrue(any("status='failed'" in c.args[0] and 'workspace_unavailable' in c.args[0] for c in db.execute.call_args_list))
