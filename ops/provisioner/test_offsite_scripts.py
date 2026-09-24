"""Entry scripts must run offsite.py on the provisioner venv, never host python3.

The missing-venv guard must be a guard *clause* (``if [[ ! -x ... ]]; then
... exit 1; fi``) with the ``exec`` AFTER the ``fi``: bash 5.1 cannot replace
the shell with ``exec`` inside a pipeline, so ``exec ... | tee`` inside an
``if`` block falls through past the ``fi`` and always hits the error branch.
"""
import pathlib
import unittest


HERE = pathlib.Path(__file__).parent
GUARD = 'if [[ ! -x "$here/.venv/bin/python" ]]; then'
EXEC = 'exec "$here/.venv/bin/python"'


def assert_guard_clause_shape(case, src):
    """Guard clause: exit 1 INSIDE the if-block, fi closed BEFORE the exec."""
    case.assertIn(GUARD, src)
    guard_open = src.index(GUARD)
    guard_close = src.index('\nfi', guard_open)
    case.assertIn('exit 1', src[guard_open:guard_close],
                  'exit 1 must be INSIDE the guard-clause if-block')
    case.assertIn('fi', src[guard_close:guard_close + 4])
    case.assertGreater(src.index(EXEC), src.index('\nfi'),
                       'exec must come AFTER the guard-clause fi')


class OffsiteSyncScriptTests(unittest.TestCase):
    def setUp(self):
        self.source = (HERE / 'offsite-sync.sh').read_text()

    def test_missing_venv_is_a_guard_clause_not_a_fallthrough(self):
        assert_guard_clause_shape(self, self.source)

    def test_exec_after_guard_clause_never_before(self):
        exec_pos = self.source.index('exec "$here/.venv/bin/python" "$here/offsite.py" sync')
        guard_close = self.source.index('\nfi')
        self.assertGreater(exec_pos, guard_close)
        self.assertIn('fi', self.source[guard_close:guard_close + 4])

    def test_missing_venv_message_before_exec_and_exactly_once(self):
        self.assertEqual(self.source.count('provisioner venv missing'), 1)
        self.assertLess(
            self.source.index('provisioner venv missing'),
            self.source.index(EXEC))
        self.assertIn('>&2', self.source)
        self.assertIn('exit 1', self.source)

    def test_never_execs_bare_system_python3(self):
        self.assertNotRegex(self.source, r'python3')

    def test_lock_serialization_and_log_kept(self):
        self.assertIn('. "$here/consumer-lock.sh"', self.source)
        self.assertIn('consumer_lock offsite-sync 300', self.source)
        self.assertIn('tee -a "$PROVISIONER_STATE_DIR/offsite.log"', self.source)
        self.assertIn('set -euo pipefail', self.source)
        self.assertIn('umask 077', self.source)


class OffsiteRestoreScriptTests(unittest.TestCase):
    def setUp(self):
        self.source = (HERE / 'offsite-restore-test.sh').read_text()

    def test_missing_venv_is_a_guard_clause_not_a_fallthrough(self):
        assert_guard_clause_shape(self, self.source)

    def test_exec_after_guard_clause_never_before(self):
        exec_pos = self.source.index('exec "$here/.venv/bin/python" "$here/offsite.py" restore')
        guard_close = self.source.index('\nfi')
        self.assertGreater(exec_pos, guard_close)
        self.assertIn('fi', self.source[guard_close:guard_close + 4])

    def test_missing_venv_message_before_exec_and_exactly_once(self):
        self.assertEqual(self.source.count('provisioner venv missing'), 1)
        self.assertLess(
            self.source.index('provisioner venv missing'),
            self.source.index(EXEC))
        self.assertIn('>&2', self.source)
        self.assertIn('exit 1', self.source)

    def test_never_execs_bare_system_python3(self):
        self.assertNotRegex(self.source, r'python3')

    def test_umask_and_path_kept(self):
        self.assertIn('umask 077', self.source)
        self.assertIn('export PATH=/usr/local/bin:/usr/bin:/bin', self.source)


class OffsitePyTimestampTests(unittest.TestCase):
    def test_offsite_lines_carry_utc_stamp_prefix(self):
        source = (HERE / 'offsite.py').read_text()
        self.assertIn("strftime('%Y-%m-%dT%H:%M:%SZ')", source)
        self.assertIn('datetime.timezone.utc', source)


if __name__ == '__main__':
    unittest.main()
