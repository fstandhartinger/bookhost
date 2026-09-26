import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
import agent_tokens
from bookstack_api_token import encrypt

KEY = bytes.fromhex('ab' * 32)


class AgentTokenTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        tenant = self.root / 'acme'
        tenant.mkdir()
        (tenant / '.initialized').touch()
        (tenant / 'docker-compose.yml').write_text('{}')
        self.patch = patch.object(agent_tokens, 'ROOT', self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def test_install_passes_secret_only_via_stdin_payload_and_clears_ciphertext(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = ('agent-id',)
        php = MagicMock(return_value=json.dumps({'user_id': 42}).encode())
        row = ('11111111-2222-3333-4444-555555555555', 'acme', 'Claude', 3, 'T' * 32, encrypt('S' * 32, 'acme', KEY))
        self.assertEqual(agent_tokens.install(db, row, KEY, php), 'active')
        code, payload = php.call_args.args[1], php.call_args.args[2]
        self.assertNotIn('S' * 32, code)
        self.assertEqual(payload['secret'], 'S' * 32)
        self.assertEqual(payload['role_id'], 3)
        self.assertIn("'admin','public','wissen-intake','bookhost-agent-api'", code)
        sql, params = db.execute.call_args.args
        self.assertIn("status='active',pending_secret_enc=NULL", sql)
        self.assertEqual(params[0], 42)

    def test_install_revoked_meanwhile_deletes_the_new_token(self):
        db = MagicMock()
        db.execute.return_value.fetchone.return_value = None
        php = MagicMock(return_value=json.dumps({'user_id': 42}).encode())
        row = ('id', 'acme', 'Claude', 3, 'T' * 32, encrypt('S' * 32, 'acme', KEY))
        self.assertEqual(agent_tokens.install(db, row, KEY, php), 'revoked')
        self.assertEqual(php.call_args.args[1], agent_tokens.REVOKE)
        self.assertEqual(php.call_args.args[2], {'token_id': 'T' * 32})

    def test_forbidden_role_marks_failed_without_token(self):
        db = MagicMock()
        php = MagicMock(return_value=json.dumps({'error': 'role'}).encode())
        row = ('id', 'acme', 'Claude', 1, 'T' * 32, encrypt('S' * 32, 'acme', KEY))
        self.assertEqual(agent_tokens.install(db, row, KEY, php), 'failed')
        self.assertIn("status='failed',pending_secret_enc=NULL", db.execute.call_args.args[0])

    def test_ciphertext_is_bound_to_the_tenant(self):
        db = MagicMock()
        row = ('id', 'acme', 'Claude', 3, 'T' * 32, encrypt('S' * 32, 'other', KEY))
        with self.assertRaises(Exception):
            agent_tokens.install(db, row, KEY, MagicMock())

    def test_revoke_deletes_token_and_marks_revoked(self):
        db = MagicMock()
        php = MagicMock(return_value=b'{"ok":true}')
        self.assertEqual(agent_tokens.revoke(db, ('id', 'acme', 'T' * 32), php), 'revoked')
        self.assertEqual(php.call_args.args[2], {'token_id': 'T' * 32})
        self.assertIn("status='revoked'", db.execute.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
