import unittest
from unittest.mock import MagicMock, patch
import worker

class CustomDomainsTests(unittest.TestCase):
    def reconcile(self, ready=True, error=False, removal=False):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [('team', 'wiki.example.org', 'customer', removal)]
        with patch.object(worker, 'domain_alias', create=True) as alias, patch.object(worker, 'domain_https_ready', return_value=ready, create=True):
            if error: alias.side_effect = RuntimeError('secret must not escape')
            worker.reconcile_domains(db, 'isolated')
        return db, alias

    def test_add_and_activate(self):
        db, alias = self.reconcile()
        alias.assert_called_once_with('customer', 'wiki.example.org', False)
        self.assertTrue(any("status='active'" in c.args[0] for c in db.execute.call_args_list))

    def test_certificate_pending_is_retryable(self):
        db, _ = self.reconcile(ready=False)
        self.assertTrue(any('Waiting for HTTPS certificate' in str(c) for c in db.execute.call_args_list))
        self.assertFalse(any("status='failed'" in c.args[0] for c in db.execute.call_args_list))

    def test_error_is_recorded_without_details(self):
        db, _ = self.reconcile(error=True)
        self.assertTrue(any('last_error' in c.args[0] for c in db.execute.call_args_list))
        self.assertNotIn('secret must not escape', str(db.execute.call_args_list))

    def test_withdrawal_removes_alias_before_release(self):
        db, alias = self.reconcile(removal=True)
        alias.assert_called_once_with('customer', 'wiki.example.org', True)
        self.assertTrue(any('DELETE FROM tenant_domains' in c.args[0] for c in db.execute.call_args_list))
