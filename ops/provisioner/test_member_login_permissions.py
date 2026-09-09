import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import tenant

spec = importlib.util.spec_from_file_location('grant_member', Path(__file__).with_name('grant-member-login-permissions.py'))
grant_member = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grant_member)


class MemberLoginPermissionsTests(unittest.TestCase):
    def test_repeated_grant_preserves_permissions_and_uses_safe_php_helper(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'test-team'
            path.mkdir()
            (path / '.initialized').touch()
            with patch.object(grant_member, 'ROOT', root), patch.object(grant_member, 'php') as php:
                grant_member.grant('test-team')
                grant_member.grant('test-team')
                self.assertEqual(php.call_count, 2)
                self.assertEqual(php.call_args_list[0], php.call_args_list[1])
                code = php.call_args.args[1]
                self.assertIn("$names=['users-manage','user-roles-manage']", code)
                self.assertIn('syncWithoutDetaching', code)
                self.assertNotIn('->sync(', code)
                self.assertIn('Wissen Intake', code)
            with patch.object(tenant, 'compose') as compose:
                tenant.php(path, 'echo 1;')
                args = compose.call_args.args
                self.assertEqual(args[args.index('-u') + 1], '1000:1000')

    def test_rejects_invalid_uninitialized_and_symlink_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'linked-team').symlink_to(root, target_is_directory=True)
            with patch.object(grant_member, 'ROOT', root), patch.object(grant_member, 'php') as php:
                for slug in ('../escape', 'missing-team', 'linked-team'):
                    with self.assertRaises(ValueError):
                        grant_member.grant(slug)
                php.assert_not_called()
