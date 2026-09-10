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
        updates = [call for call in db.execute.call_args_list if "SET status='error'" in call.args[0]]
        self.assertEqual(len(updates), 1)
        self.assertEqual(updates[0].args[1], ("id",))
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
