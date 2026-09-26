import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import live_edit_rollout


class EnvWriteTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name)
        (self.path / '.env').write_text('APP_URL=https://acme.bookhost.co\nDB_PASSWORD=secret\n')

    def tearDown(self):
        self.folder.cleanup()

    def test_appends_new_keys_and_preserves_existing_ones(self):
        live_edit_rollout._env_write(self.path, {'APP_THEME': 'live-edit', 'LIVE_EDIT_TENANT_SLUG': 'acme'})
        content = (self.path / '.env').read_text()
        self.assertIn('APP_URL=https://acme.bookhost.co\n', content)
        self.assertIn('DB_PASSWORD=secret\n', content)
        # shlex.quote only adds quotes when a value actually needs them; these
        # simple values round-trip unquoted, same as tenant.py's provision().
        self.assertIn('APP_THEME=live-edit\n', content)
        self.assertIn('LIVE_EDIT_TENANT_SLUG=acme\n', content)

    def test_replaces_an_existing_key_in_place_without_duplicating(self):
        live_edit_rollout._env_write(self.path, {'APP_URL': 'https://changed.example'})
        content = (self.path / '.env').read_text()
        self.assertEqual(content.count('APP_URL='), 1)
        self.assertIn('APP_URL=https://changed.example\n', content)

    def test_shell_unsafe_secret_is_quoted_not_interpolated(self):
        secret = "a'b$(rm -rf /)c"
        live_edit_rollout._env_write(self.path, {'LIVE_EDIT_HMAC_SECRET': secret})
        content = (self.path / '.env').read_text()
        self.assertIn('LIVE_EDIT_HMAC_SECRET=', content)
        # shlex.quote must make this byte-identical on read-back, never executed.
        import shlex
        line = next(l for l in content.splitlines() if l.startswith('LIVE_EDIT_HMAC_SECRET='))
        self.assertEqual(shlex.split(line)[0].split('=', 1)[1], secret)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.tenant = self.root / 'acme'
        self.tenant.mkdir()
        (self.tenant / '.initialized').touch()
        (self.tenant / '.env').write_text('APP_URL=https://acme.bookhost.co\n')
        compose_doc = {'services': {'bookstack': {'environment': {'APP_URL': '${APP_URL}'}}, 'db': {}}}
        (self.tenant / 'docker-compose.yml').write_text(json.dumps(compose_doc))

    def tearDown(self):
        self.folder.cleanup()

    def test_refuses_when_tenant_already_has_a_custom_theme(self):
        (self.tenant / '.env').write_text('APP_URL=https://acme.bookhost.co\nAPP_THEME=acme-custom\n')
        original_env = (self.tenant / '.env').read_bytes()
        compose_fn = MagicMock()
        php_fn = MagicMock()
        with self.assertRaises(RuntimeError) as ctx:
            live_edit_rollout.install(self.tenant, 'shh', compose_fn=compose_fn, php_fn=php_fn)
        self.assertIn('custom BookStack theme', str(ctx.exception))
        # Refuses before touching anything.
        compose_fn.assert_not_called()
        php_fn.assert_not_called()
        self.assertEqual((self.tenant / '.env').read_bytes(), original_env)

    def test_refuses_a_custom_theme_declared_only_in_compose(self):
        compose_path = self.tenant / 'docker-compose.yml'
        document = json.loads(compose_path.read_text())
        document['services']['bookstack']['environment']['APP_THEME'] = 'acme-custom'
        compose_path.write_text(json.dumps(document))
        original_env = (self.tenant / '.env').read_bytes()
        original_compose = compose_path.read_bytes()
        compose_fn = MagicMock()
        php_fn = MagicMock()
        with self.assertRaises(RuntimeError) as ctx:
            live_edit_rollout.install(self.tenant, 'shh', compose_fn=compose_fn, php_fn=php_fn)
        self.assertIn('APP_THEME=acme-custom', str(ctx.exception))
        compose_fn.assert_not_called()
        php_fn.assert_not_called()
        self.assertEqual((self.tenant / '.env').read_bytes(), original_env)
        self.assertEqual(compose_path.read_bytes(), original_compose)

    def test_refuses_a_custom_theme_from_compose_default_interpolation(self):
        compose_path = self.tenant / 'docker-compose.yml'
        document = json.loads(compose_path.read_text())
        document['services']['bookstack']['environment']['APP_THEME'] = '${APP_THEME:-acme-custom}'
        compose_path.write_text(json.dumps(document))
        compose_fn = MagicMock()
        with self.assertRaises(RuntimeError):
            live_edit_rollout.install(self.tenant, 'shh', compose_fn=compose_fn)
        compose_fn.assert_not_called()

    def test_allows_a_second_run_when_theme_is_already_live_edit(self):
        (self.tenant / '.env').write_text('APP_URL=https://acme.bookhost.co\nAPP_THEME=live-edit\n')
        compose_fn = MagicMock()
        ready_fn = MagicMock()
        php_fn = MagicMock()
        probe_fn = MagicMock(return_value=True)
        self.assertTrue(live_edit_rollout.install(
            self.tenant, 'shh', compose_fn=compose_fn, ready_fn=ready_fn, php_fn=php_fn, probe_fn=probe_fn,
        ))

    def test_writes_theme_file_and_compose_env_then_probes(self):
        compose_fn = MagicMock()
        ready_fn = MagicMock()
        php_fn = MagicMock()
        probe_fn = MagicMock(return_value=True)
        self.assertTrue(live_edit_rollout.install(
            self.tenant, 'shh', compose_fn=compose_fn, ready_fn=ready_fn, php_fn=php_fn, probe_fn=probe_fn,
        ))
        theme_file = self.tenant / 'bookstack' / 'www' / 'themes' / 'live-edit' / 'functions.php'
        self.assertTrue(theme_file.exists())
        self.assertIn('ROUTES_REGISTER_WEB_AUTH', theme_file.read_text())
        document = json.loads((self.tenant / 'docker-compose.yml').read_text())
        env = document['services']['bookstack']['environment']
        self.assertEqual(env['APP_THEME'], '${APP_THEME}')
        self.assertEqual(env['LIVE_EDIT_TENANT_SLUG'], '${LIVE_EDIT_TENANT_SLUG}')
        self.assertIn('LIVE_EDIT_HMAC_SECRET=', (self.tenant / '.env').read_text())
        compose_fn.assert_called_once_with(self.tenant, 'up', '-d', '--no-deps', '--force-recreate', 'bookstack')
        probe_fn.assert_called_once_with('https://acme.bookhost.co')
        php_fn.assert_called_once()
        self.assertIn('bookhost-live-edit:start', php_fn.call_args.args[2]['html'])

    def test_rolls_back_env_and_compose_when_the_route_probe_fails(self):
        original_env = (self.tenant / '.env').read_bytes()
        original_compose = (self.tenant / 'docker-compose.yml').read_bytes()
        compose_fn = MagicMock()
        ready_fn = MagicMock()
        php_fn = MagicMock()
        probe_fn = MagicMock(return_value=False)  # theme route never actually registered
        with self.assertRaises(RuntimeError):
            live_edit_rollout.install(
                self.tenant, 'shh', compose_fn=compose_fn, ready_fn=ready_fn, php_fn=php_fn, probe_fn=probe_fn,
            )
        self.assertEqual((self.tenant / '.env').read_bytes(), original_env)
        self.assertEqual((self.tenant / 'docker-compose.yml').read_bytes(), original_compose)
        # Rollback also recreates the container to get back to the old, working config.
        self.assertEqual(compose_fn.call_count, 2)
        php_fn.assert_not_called()  # app-custom-head must never point at a route that isn't live

    def test_rolls_back_when_the_container_never_becomes_ready(self):
        original_env = (self.tenant / '.env').read_bytes()
        compose_fn = MagicMock()
        ready_fn = MagicMock(side_effect=RuntimeError('BookStack initialization timed out'))
        php_fn = MagicMock()
        with self.assertRaises(RuntimeError):
            live_edit_rollout.install(self.tenant, 'shh', compose_fn=compose_fn, ready_fn=ready_fn, php_fn=php_fn)
        self.assertEqual((self.tenant / '.env').read_bytes(), original_env)
        php_fn.assert_not_called()

    def test_rollback_recovery_failure_does_not_hide_the_original_error(self):
        compose_calls = {'n': 0}

        def flaky_compose(*args, **kwargs):
            compose_calls['n'] += 1
            if compose_calls['n'] > 1:
                raise RuntimeError('docker compose unavailable')

        ready_fn = MagicMock()
        php_fn = MagicMock()
        probe_fn = MagicMock(return_value=False)
        with self.assertRaises(RuntimeError) as ctx:
            live_edit_rollout.install(
                self.tenant, 'shh', compose_fn=flaky_compose, ready_fn=ready_fn, php_fn=php_fn, probe_fn=probe_fn,
            )
        self.assertIn('did not come up', str(ctx.exception))


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        tenant = self.root / 'acme'
        tenant.mkdir()
        (tenant / '.initialized').touch()
        (tenant / 'docker-compose.yml').write_text('{}')
        self.patch = patch.object(live_edit_rollout, 'ROOT', self.root)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.folder.cleanup()

    def test_marks_ready_on_success(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [('tenant-id', 'acme', 'v1:enc')]
        with patch.object(live_edit_rollout, 'decrypt', return_value='plainsecret'), \
             patch.object(live_edit_rollout, 'kms_key', return_value=b'k'), \
             patch.object(live_edit_rollout, 'install', return_value=True) as install:
            live_edit_rollout.reconcile_live_edit(db, 'production')
        install.assert_called_once()
        self.assertEqual(install.call_args.args[1], 'plainsecret')
        update_sql = db.execute.call_args_list[-2].args[0]
        self.assertIn("rollout_status='ready'", update_sql)

    def test_marks_failed_with_a_safe_message_on_any_exception(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [('tenant-id', 'acme', 'v1:enc')]
        with patch.object(live_edit_rollout, 'decrypt', return_value='plainsecret'), \
             patch.object(live_edit_rollout, 'kms_key', return_value=b'k'), \
             patch.object(live_edit_rollout, 'install', side_effect=RuntimeError('some low-level docker detail')):
            live_edit_rollout.reconcile_live_edit(db, 'production')
        update_sql, params = db.execute.call_args_list[-2].args
        self.assertIn("rollout_status='failed'", update_sql)
        self.assertNotIn('docker detail', params[0])

    def test_skips_a_tenant_directory_that_is_not_ready(self):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [('tenant-id', 'not-yet-provisioned', 'v1:enc')]
        with patch.object(live_edit_rollout, 'install') as install:
            live_edit_rollout.reconcile_live_edit(db, 'production')
        install.assert_not_called()


if __name__ == '__main__':
    unittest.main()
