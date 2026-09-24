"""Entry scripts must run offsite.py on the provisioner venv, never host python3."""
import pathlib
import unittest


HERE = pathlib.Path(__file__).parent


class OffsiteSyncScriptTests(unittest.TestCase):
    def setUp(self):
        self.source = (HERE/'offsite-sync.sh').read_text()

    def test_uses_provisioner_venv_interpreter(self):
        self.assertIn('if [[ -x "$here/.venv/bin/python" ]]; then', self.source)
        self.assertIn('exec "$here/.venv/bin/python" "$here/offsite.py" sync', self.source)

    def test_never_execs_bare_system_python3(self):
        self.assertNotRegex(self.source,r'python3')

    def test_missing_venv_fails_loudly(self):
        self.assertIn('provisioner venv missing', self.source)
        self.assertIn('>&2', self.source)
        self.assertIn('exit 1', self.source)

    def test_lock_serialization_and_log_kept(self):
        self.assertIn('. "$here/consumer-lock.sh"', self.source)
        self.assertIn('consumer_lock offsite-sync 300', self.source)
        self.assertIn('tee -a "$PROVISIONER_STATE_DIR/offsite.log"', self.source)
        self.assertIn('set -euo pipefail', self.source)
        self.assertIn('umask 077', self.source)


class OffsiteRestoreScriptTests(unittest.TestCase):
    def setUp(self):
        self.source = (HERE/'offsite-restore-test.sh').read_text()

    def test_uses_provisioner_venv_interpreter(self):
        self.assertIn('if [[ -x "$here/.venv/bin/python" ]]; then', self.source)
        self.assertIn('exec "$here/.venv/bin/python" "$here/offsite.py" restore "$@"', self.source)

    def test_never_execs_bare_system_python3(self):
        self.assertNotRegex(self.source,r'python3')

    def test_missing_venv_fails_loudly(self):
        self.assertIn('provisioner venv missing', self.source)
        self.assertIn('>&2', self.source)
        self.assertIn('exit 1', self.source)

    def test_umask_and_path_kept(self):
        self.assertIn('umask 077', self.source)
        self.assertIn('export PATH=/usr/local/bin:/usr/bin:/bin', self.source)


class OffsitePyTimestampTests(unittest.TestCase):
    def test_offsite_lines_carry_utc_stamp_prefix(self):
        source = (HERE/'offsite.py').read_text()
        self.assertIn("strftime('%Y-%m-%dT%H:%M:%SZ')", source)
        self.assertIn('datetime.timezone.utc', source)


if __name__=='__main__': unittest.main()