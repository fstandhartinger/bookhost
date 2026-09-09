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
            with patch.object(token, 'ROOT', root), patch.object(token, 'kms_key', return_value=bytes.fromhex('ab' * 32)), patch.object(token, 'php', return_value=b'service') as php, patch.object(token, 'api_valid', return_value=True):
                first = token.ensure_token('demo')
                second = token.ensure_token('demo')
                self.assertEqual(first, second)
                self.assertEqual(php.call_count, 2)
                self.assertIn("'book-create-all'", php.call_args_list[0].args[1])
                self.assertIn("'book-create-all'", php.call_args_list[1].args[1])
                self.assertIn("'system_name'=>'wissen-intake'", php.call_args_list[1].args[1])
                for call in php.call_args_list:
                    self.assertIn("'users-manage','user-roles-manage'", call.args[1])
                rotated = token.ensure_token('demo', rotate=True)
                self.assertNotEqual(first[0], rotated[0])
                values = token.env_read(tenant / '.env')
                self.assertTrue(values['BOOKSTACK_API_ID'].startswith('v1:'))
                self.assertTrue(values['BOOKSTACK_API_SECRET'].startswith('v1:'))
                self.assertNotIn(first[0], (tenant / '.env').read_text())
                self.assertEqual(os.stat(tenant / '.env').st_mode & 0o777, 0o600)
