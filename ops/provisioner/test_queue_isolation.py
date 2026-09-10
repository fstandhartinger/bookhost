import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import worker


class QueueIsolationTests(unittest.TestCase):
    def run_worker_for(self, row):
        root = Path(tempfile.mkdtemp())
        db = MagicMock()

        def execute(sql, params=None):
            result = MagicMock()
            if sql.startswith("SELECT id,slug,admin_email"):
                result.fetchall.return_value = [row]
            else:
                result.fetchall.return_value = []
            result.fetchone.return_value = (row[0],)
            return result

        db.execute.side_effect = execute
        env = {
            "DATABASE_URL_LOCAL": "mock",
            "APP_URL": "https://example.invalid",
            "BOOKSTACK_ADMIN_PASSWORD": "not-a-secret",
        }
        with patch.object(worker.psycopg, "connect") as connect, \
             patch.object(worker, "ROOT", root), \
             patch.object(worker, "env_read", return_value=env), \
             patch.object(worker, "capacity", return_value=True), \
             patch.object(worker, "command") as command, \
             patch.object(worker, "store_token"):
            connect.return_value.__enter__.return_value = db
            worker.once()
        return db, command

    def test_reserved_test_slug_is_failed_without_provisioning(self):
        db, command = self.run_worker_for(("id", "rc-review", "admin@example.org", "pending", "running", None))
        command.assert_not_called()
        updates = [call for call in db.execute.call_args_list if "SET status='failed'" in call.args[0]]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].args[1], ("production", "id",))
        self.assertIn("Reserved test slug; provision manually in an isolated checkout", updates[0].args[0])

    def test_foreign_instance_is_skipped_without_update(self):
        db, command = self.run_worker_for(("id", "customer-team", "admin@example.org", "pending", "running", "acceptance"))
        command.assert_not_called()
        self.assertFalse(any("UPDATE tenants" in call.args[0] for call in db.execute.call_args_list))

    def test_matching_instance_and_null_instance_are_processed(self):
        for instance in ("production", None):
            with self.subTest(instance=instance):
                db, command = self.run_worker_for(("id", "customer-team", "admin@example.org", "pending", "running", instance))
                command.assert_called_once_with("provision", "customer-team", "admin@example.org")
                self.assertTrue(any("SET status='provisioning'" in call.args[0] for call in db.execute.call_args_list))


if __name__ == "__main__":
    unittest.main()

class LimitsFallbackTest(unittest.TestCase):
    def test_missing_limits_file_falls_back_to_defaults(self):
        import worker, pathlib, tempfile, unittest.mock as mock
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(worker, 'HERE', pathlib.Path(d)):
                self.assertEqual(worker.limits(), {})
                self.assertEqual(worker.reserved_test_prefixes(), worker.DEFAULT_RESERVED_TEST_PREFIXES)


class CriticalIsolationTests(QueueIsolationTests):
    def test_acceptance_must_not_process_legacy_null(self):
        with patch.dict(worker.os.environ, {'PROVISIONER_INSTANCE':'acceptance'}):
            db, command = self.run_worker_for(('id','customer-team','a@example.org','pending','running',None))
        command.assert_not_called()
        self.assertFalse(any('UPDATE tenants' in c.args[0] for c in db.execute.call_args_list))

    def test_all_queue_reads_and_writes_are_scoped_including_stale_cleanup(self):
        db, _ = self.run_worker_for(('id','customer-team','a@example.org','pending','running','production'))
        for call in db.execute.call_args_list:
            sql=call.args[0]
            if sql.startswith(('SELECT','UPDATE tenants')):
                self.assertIn("COALESCE(provisioner_instance,'production')",sql)
                self.assertIn('production',call.args[1])

class StaleIsolationTests(unittest.TestCase):
    def test_acceptance_stale_cleanup_never_receives_foreign_or_legacy_rows(self):
        db=MagicMock()
        stale=[('acceptance-id','own-tenant','acceptance'),('production-id','other-tenant','production'),('legacy-id','legacy-tenant',None)]
        def execute(sql,params=None):
            result=MagicMock()
            if sql.startswith('SELECT id,slug FROM tenants'):
                scoped="COALESCE(provisioner_instance,'production')=%s" in sql
                result.fetchall.return_value=[r[:2] for r in stale if not scoped or (r[2] or 'production')==params[0]]
            else: result.fetchall.return_value=[]
            return result
        db.execute.side_effect=execute
        with tempfile.TemporaryDirectory() as d, patch.object(worker,'ROOT',Path(d)), patch.dict(worker.os.environ,{'PROVISIONER_INSTANCE':'acceptance'}), patch.object(worker,'env_read',return_value={'DATABASE_URL_LOCAL':'mock'}), patch.object(worker.psycopg,'connect') as connect, patch.object(worker,'command') as command:
            connect.return_value.__enter__.return_value=db
            worker.once()
        updates=[c for c in db.execute.call_args_list if c.args[0].startswith('UPDATE tenants')]
        self.assertEqual(len(updates),1)
        self.assertIn('acceptance-id',updates[0].args[1])
        self.assertNotIn('production-id',updates[0].args[1])
        command.assert_not_called()
