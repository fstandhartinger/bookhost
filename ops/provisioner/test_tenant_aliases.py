import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import tenant


class TenantAliasTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'alias-test'
        self.path.mkdir()
        (self.path / '.initialized').touch()
        (self.path / '.env').write_text("APP_URL=https://old.example.org\nDB_PASSWORD='unchanged value'\n")
        tenant.config(self.path)

    def cli(self, *args):
        out = io.StringIO()
        with patch.object(tenant, 'ROOT', self.root), patch.object(tenant.sys, 'argv', ['tenant.py', *args]), patch.object(tenant, 'compose') as compose, patch.object(tenant, 'sql') as sql, patch.object(tenant, 'php') as php, patch.object(tenant, 'run') as run, contextlib.redirect_stdout(out):
            tenant.main()
        sql.assert_not_called()
        php.assert_not_called()
        run.assert_not_called()
        return compose, out.getvalue()

    def rule(self):
        cfg = json.loads((self.path / 'docker-compose.yml').read_text())
        labels = cfg['services']['bookstack']['labels']
        rules = [labels[f'traefik.http.routers.wissen-alias-test-{s}.rule'] for s in ('http', 'https')]
        self.assertEqual(rules[0], rules[1])
        return rules[0]

    def test_parse_comments_blanks_duplicates_and_stable_rule(self):
        (self.path / 'aliases').write_text('# comment\n\nb.example.org # inline\na.example.org\nb.example.org\nold.example.org\n')
        self.assertEqual(tenant.read_aliases(self.path), ['b.example.org', 'a.example.org', 'old.example.org'])
        original = (self.path / '.env').read_bytes()
        tenant.config(self.path)
        self.assertEqual(self.rule(), 'Host(`old.example.org`) || Host(`b.example.org`) || Host(`a.example.org`)')
        self.assertEqual((self.path / '.env').read_bytes(), original)

    def test_invalid_file_entries_fail_without_writing_compose(self):
        before = (self.path / 'docker-compose.yml').read_bytes()
        for host in ['*.example.org', 'UP.example.org', 'localhost', 'a..org', '-a.org', 'a-.org', 'https://a.org', 'a.org/path', 'a.org`)', 'a.org b.org', '.a.org', 'a.org.', 'a_' + '.org']:
            with self.subTest(host=host):
                (self.path / 'aliases').write_text(host + '\n')
                with self.assertRaises(ValueError):
                    tenant.config(self.path)
                self.assertEqual((self.path / 'docker-compose.yml').read_bytes(), before)

    def test_alias_commands_only_recreate_app_preserve_db_and_env(self):
        before = json.loads((self.path / 'docker-compose.yml').read_text())
        env = (self.path / '.env').read_bytes()
        for option, value, expected in [('--set', 'b.example.org,a.example.org,b.example.org', ['b.example.org', 'a.example.org']), ('--add', 'c.example.org', ['b.example.org', 'a.example.org', 'c.example.org']), ('--remove', 'a.example.org', ['b.example.org', 'c.example.org']), ('--set', '', [])]:
            compose, output = self.cli('aliases', 'alias-test', option, value)
            compose.assert_called_once_with(self.path, 'up', '-d', '--no-deps', 'bookstack')
            self.assertIn('ALIASES restart required', output)
            self.assertEqual(tenant.read_aliases(self.path), expected)
            self.assertEqual((self.path / '.env').read_bytes(), env)
            after = json.loads((self.path / 'docker-compose.yml').read_text())
            self.assertEqual(before['services']['db'], after['services']['db'])
            self.assertEqual(before['services']['bookstack']['volumes'], after['services']['bookstack']['volumes'])

    def test_list_and_default_do_not_write_or_restart(self):
        (self.path / 'aliases').write_text('a.example.org\n')
        before = (self.path / 'docker-compose.yml').read_bytes()
        for args in [[], ['--list']]:
            compose, output = self.cli('aliases', 'alias-test', *args)
            compose.assert_not_called()
            self.assertEqual(output, 'a.example.org\n')
        self.assertEqual((self.path / 'docker-compose.yml').read_bytes(), before)

    def test_rehost_preserves_old_optionally_and_removes_new_alias(self):
        for keep in (False, True):
            (self.path / '.env').write_text("APP_URL=https://old.example.org\nDB_PASSWORD='unchanged value'\n")
            (self.path / 'aliases').write_text('new.example.org\nother.example.org\n')
            compose, output = self.cli('rehost', 'alias-test', 'new.example.org', *(['--keep-old-as-alias'] if keep else []))
            compose.assert_called_once_with(self.path, 'up', '-d', '--no-deps', 'bookstack')
            self.assertEqual(tenant.env_read(self.path / '.env'), {'APP_URL': 'https://new.example.org', 'DB_PASSWORD': 'unchanged value'})
            self.assertEqual(tenant.read_aliases(self.path), ['other.example.org'] + (['old.example.org'] if keep else []))
            self.assertEqual(self.rule(), 'Host(`new.example.org`) || Host(`other.example.org`)' + (' || Host(`old.example.org`)' if keep else ''))
            self.assertIn('new.example.org', output)

    def test_invalid_cli_has_no_side_effects(self):
        before = {p.name: p.read_bytes() for p in self.path.iterdir()}
        for args in [('aliases', '../evil', '--list'), ('rehost', 'UPPER', 'new.example.org'), ('aliases', 'alias-test', '--add', '*.org'), ('aliases', 'alias-test', '--set', 'good.org,bad'), ('rehost', 'alias-test', 'https://new.org'), ('aliases', 'alias-test', '--add', 'ok.org', '--list'), ('rehost', 'alias-test', 'ok.org', '--typo')]:
            with self.subTest(args=args), patch.object(tenant, 'compose') as compose:
                with self.assertRaises((ValueError, SystemExit)):
                    self.cli(*args)
                compose.assert_not_called()
                self.assertEqual({p.name: p.read_bytes() for p in self.path.iterdir()}, before)

    def test_missing_env_and_uninitialized_tenant_are_rejected(self):
        (self.path / '.initialized').unlink()
        with self.assertRaises(ValueError):
            self.cli('aliases', 'alias-test', '--add', 'new.org')
        (self.path / '.initialized').touch()
        (self.path / '.env').unlink()
        with self.assertRaises(ValueError):
            self.cli('rehost', 'alias-test', 'new.org')

    def test_rehost_preserves_custom_compose_and_volumes(self):
        target = self.path / 'docker-compose.yml'
        before = json.loads(target.read_text())
        before['services']['db']['image'] = 'custom-db-image'
        before['services']['bookstack']['image'] = 'custom-app-image'
        before['services']['bookstack']['environment']['CUSTOM'] = 'preserved'
        target.write_text(json.dumps(before))
        self.cli('rehost', 'alias-test', 'new.example.org')
        after = json.loads(target.read_text())
        for scheme in ('http', 'https'):
            before['services']['bookstack']['labels'][f'traefik.http.routers.wissen-alias-test-{scheme}.rule'] = 'Host(`new.example.org`)'
        self.assertEqual(after, before)

    def test_regeneration_failure_rolls_back_files_without_restart(self):
        before = {p.name: p.read_bytes() for p in self.path.iterdir()}
        with patch.object(tenant, 'config', side_effect=RuntimeError('fixture failure')), patch.object(tenant, 'compose') as compose:
            with self.assertRaisesRegex(RuntimeError, 'fixture failure'):
                tenant.host_command(self.path, 'rehost', ['new.example.org', '--keep-old-as-alias'])
            compose.assert_not_called()
        self.assertEqual({p.name: p.read_bytes() for p in self.path.iterdir()}, before)

    def test_missing_alias_file_and_dns_length_limits(self):
        self.assertEqual(tenant.read_aliases(self.path), [])
        for host in ['a' * 64 + '.org', '.'.join(['a' * 63] * 4)]:
            with self.assertRaises(ValueError):
                self.cli('rehost', 'alias-test', host)
