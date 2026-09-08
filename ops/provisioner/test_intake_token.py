import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import bookstack_api_token as token


class IntakeTokenTests(unittest.TestCase):
    def test_authenticated_encryption_binds_to_tenant(self):
        key = bytes.fromhex('ab' * 32)
        value = token.encrypt('fixture-secret', 'demo', key)
        self.assertNotIn('fixture-secret', value)
        self.assertEqual(token.decrypt(value, 'demo', key), 'fixture-secret')
        with self.assertRaises(Exception):
            token.decrypt(value, 'other', key)

    def test_idempotent_bootstrap_stores_only_ciphertext(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            tenant = root / 'demo'
            tenant.mkdir()
            (tenant / '.initialized').touch()
            (tenant / '.env').write_text('BOOKSTACK_ADMIN_EMAIL=admin@example.invalid\n')
            with patch.object(token, 'ROOT', root), patch.object(token, 'kms_key', return_value=bytes.fromhex('ab' * 32)), patch.object(token, 'php') as php:
                first = token.ensure_token('demo')
                second = token.ensure_token('demo')
                self.assertEqual(first, second)
                self.assertEqual(php.call_count, 2)
                values = token.env_read(tenant / '.env')
                self.assertTrue(values['BOOKSTACK_API_ID'].startswith('v1:'))
                self.assertTrue(values['BOOKSTACK_API_SECRET'].startswith('v1:'))
                self.assertNotIn(first[0], (tenant / '.env').read_text())
                self.assertEqual(os.stat(tenant / '.env').st_mode & 0o777, 0o600)
