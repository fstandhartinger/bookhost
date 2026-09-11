"""A pinned image and a promise of security updates: the line must say which."""
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w


class VersionStateTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'bookstack-version.log'
        self.now = time.time()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def write(self, text, age=0):
        self.log.write_text(text)
        stamp = self.now - age
        import os
        os.utime(self.log, (stamp, stamp))

    def test_missing_file_is_not_reported_as_current(self):
        self.assertIn('nie geprueft', w.version_state(self.log, self.now))

    def test_empty_file_says_so(self):
        self.write('')
        self.assertIn('ohne Ausgabe', w.version_state(self.log, self.now))

    def test_current_version_reports_age(self):
        self.write('OK: wir fahren die aktuelle BookStack-Version.\n', age=2 * 3600)
        line = w.version_state(self.log, self.now)
        self.assertIn('aktuell', line)
        self.assertIn('2 h', line)

    def test_behind_upstream_is_named(self):
        self.write('gepinnt: v25.02.1\n  ZURUECK: upstream ist weiter.\n')
        self.assertIn('ZURUECK', w.version_state(self.log, self.now))

    def test_stale_check_is_not_reported_as_current(self):
        # A check that stopped running must not read as "aktuell" forever.
        self.write('OK: wir fahren die aktuelle BookStack-Version.\n', age=40 * 3600)
        line = w.version_state(self.log, self.now)
        self.assertIn('nicht geprueft', line)
        self.assertNotIn('aktuell', line)

    def test_failed_check_is_distinguished_from_a_lag(self):
        self.write('FEHLER: kein Image-Tag in tenant.py gefunden\n')
        line = w.version_state(self.log, self.now)
        self.assertIn('fehlgeschlagen', line)
        self.assertNotIn('ZURUECK', line)


if __name__ == '__main__':
    unittest.main()
