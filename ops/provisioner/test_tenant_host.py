import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import worker
import tenant

class TenantHostTests(unittest.TestCase):
    def test_running_update_stores_actual_host_for_new_and_resumed_tenants(self):
        for existing in (False, True):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                path = root / 'host-test'
                path.mkdir()
                if existing:
                    (path / '.initialized').touch()
                    (path / '.env').touch()
                    (path / 'docker-compose.yml').touch()
                host = 'host-test.wissen.app.mintapis.com' if existing else 'host-test.bookhost.co'
                db = MagicMock()
                def execute(sql, params=None):
                    result = MagicMock()
                    result.fetchall.return_value = [('id', 'host-test', 'admin@example.org', 'suspended' if existing else 'pending', 'running')] if sql.startswith('SELECT id,slug,admin_email') else []
                    result.fetchone.return_value = ('id',)
                    return result
                db.execute.side_effect = execute
                with patch.object(worker.psycopg, 'connect') as connect, patch.object(worker, 'ROOT', root), patch.object(worker, 'env_read', return_value={'DATABASE_URL_LOCAL': 'mock', 'APP_URL': 'https://' + host, 'BOOKSTACK_ADMIN_PASSWORD': 'test'}), patch.object(worker, 'command'), patch.object(worker, 'store_token'), patch.object(worker, 'capacity', return_value=True):
                    connect.return_value.__enter__.return_value = db
                    worker.once()
                updates = [call for call in db.execute.call_args_list if "SET status='running'" in call.args[0]]
                self.assertEqual(len(updates), 1)
                self.assertRegex(updates[0].args[0], r'host\s*=\s*%s')
                self.assertIn(host, updates[0].args[1])

    def test_arbitrary_domain_in_router_and_app_url(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'host-test'
            path.mkdir()
            with patch.object(tenant, 'TENANT_DOMAIN', 'wiki.example.org'), patch.object(tenant, 'compose'), patch.object(tenant, 'ready_internal'), patch.object(tenant, 'public_ready'), patch.object(tenant, 'php'), patch.object(tenant, 'seed_starter_book'), patch.object(tenant, 'backup'):
                tenant.provision(path, 'admin@example.org')
            self.assertEqual(tenant.env_read(path / '.env')['APP_URL'], 'https://host-test.wiki.example.org')
            self.assertIn('Host(`host-test.wiki.example.org`)', (path / 'docker-compose.yml').read_text())

    def test_api_token_check_uses_persisted_url_after_domain_change(self):
        import bookstack_api_token as token
        with patch.object(token, 'env_read', return_value={'APP_URL': 'https://custom.bookhost.co'}), patch.object(token.urllib.request, 'urlopen') as request:
            request.return_value.__enter__.return_value.status = 200
            self.assertTrue(token.api_valid('host-test', 'test-id', 'test-secret'))
            self.assertEqual(request.call_args.args[0].full_url, 'https://custom.bookhost.co/api/books?count=1')
