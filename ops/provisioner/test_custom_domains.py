import pathlib
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

class DomainTransportTests(unittest.TestCase):
    def test_alias_uses_existing_path_and_never_rehost(self):
        with patch.object(worker.subprocess, 'run') as run:
            worker.domain_alias('customer', 'wiki.example.org')
        args = run.call_args.args[0]
        self.assertEqual(args[-4:], ['aliases', 'customer', '--add', 'wiki.example.org'])
        self.assertEqual(run.call_args.kwargs['timeout'], 120)

    def test_tls_uses_fixed_private_ip_with_customer_sni(self):
        with patch.dict(worker.os.environ, {'CUSTOM_DOMAIN_PROXY_IP': '127.0.0.1'}), patch.object(worker.socket, 'create_connection') as connect, patch.object(worker.ssl, 'create_default_context') as context:
            tls = context.return_value.wrap_socket.return_value.__enter__.return_value
            tls.recv.return_value = b'HTTP/1.1 200 OK\r\n'
            self.assertTrue(worker.domain_https_ready('wiki.example.org'))
            connect.assert_called_once_with(('127.0.0.1', 443), timeout=5)
            self.assertEqual(context.return_value.wrap_socket.call_args.kwargs['server_hostname'], 'wiki.example.org')

    def test_untrusted_certificate_stays_pending(self):
        with patch.object(worker.socket, 'create_connection', side_effect=worker.ssl.SSLError('bad certificate')):
            self.assertFalse(worker.domain_https_ready('wiki.example.org'))

    def test_public_proxy_address_rejected_before_network(self):
        with patch.dict(worker.os.environ, {'CUSTOM_DOMAIN_PROXY_IP': '8.8.8.8'}), patch.object(worker.socket, 'create_connection') as connect:
            with self.assertRaises(ValueError): worker.domain_https_ready('wiki.example.org')
            connect.assert_not_called()


class DomainBackoffTest(unittest.TestCase):
    def test_query_paces_retries_and_stops_after_twenty(self):
        source = (pathlib.Path(__file__).with_name('worker.py')).read_text()
        self.assertIn('d.attempts < 20', source)
        self.assertIn("interval '1 minute' * LEAST(60, GREATEST(1, d.attempts*d.attempts))", source)
        self.assertIn('attempts=attempts+1', source)
        self.assertIn("status='active',active_at=now(),last_error=NULL,attempts=0", source)
        self.assertIn('press Check again', source)
