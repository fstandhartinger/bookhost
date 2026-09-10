"""The watchdog checks the worker; this checks the watchdog."""
import importlib
import os
import pathlib
import shutil
import tempfile
import time
import unittest

worker = importlib.import_module('worker')


class WatchdogSilenceTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.log = self.root / 'watchdog.log'
        self.now = 1_800_000_000.0

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def line(self, offset_seconds):
        stamp = time.strftime(
            '%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(self.now - offset_seconds))
        with open(self.log, 'a', encoding='utf-8') as handle:
            handle.write(f'{stamp} Backups: ok — fehlend/veraltet: keine\n')

    def warnings(self):
        if not self.log.exists():
            return []
        return [l for l in self.log.read_text().splitlines() if 'WAECHTER STUMM' in l]

    def test_fresh_watchdog_says_nothing(self):
        self.line(120)
        self.assertFalse(worker.report_watchdog_silence(self.now, self.root))
        self.assertEqual(self.warnings(), [])

    def test_silent_watchdog_is_written_into_its_own_log(self):
        self.line(3 * 3600)
        self.assertTrue(worker.report_watchdog_silence(self.now, self.root))
        warnings = self.warnings()
        self.assertEqual(len(warnings), 1)
        self.assertIn('180 Minuten', warnings[0])
        self.assertIn('KEIN Beleg', warnings[0])

    def test_missing_log_is_reported_too(self):
        # No log at all is the worst case, not a quiet success.
        self.assertTrue(worker.report_watchdog_silence(self.now, self.root))
        self.assertIn('unbekannt', self.warnings()[0])

    def test_warning_does_not_repeat_every_minute(self):
        self.line(3 * 3600)
        worker.report_watchdog_silence(self.now, self.root)
        for extra in (60, 120, 300):
            worker.report_watchdog_silence(self.now + extra, self.root)
        self.assertEqual(len(self.warnings()), 1)
        worker.report_watchdog_silence(self.now + 11 * 60, self.root)
        self.assertEqual(len(self.warnings()), 2)

    def test_returning_watchdog_clears_the_marker(self):
        self.line(3 * 3600)
        worker.report_watchdog_silence(self.now, self.root)
        self.assertTrue((self.root / '.watchdog-silence').exists())
        self.line(0)
        self.assertFalse(worker.report_watchdog_silence(self.now, self.root))
        self.assertFalse((self.root / '.watchdog-silence').exists())

    def test_unparsable_tail_falls_back_to_the_last_readable_line(self):
        self.line(120)
        with open(self.log, 'a', encoding='utf-8') as handle:
            handle.write('kaputte Zeile ohne Zeitstempel\n')
        self.assertFalse(worker.report_watchdog_silence(self.now, self.root))

    def test_our_own_warning_does_not_look_like_a_watchdog_line(self):
        # The warning carries a timestamp too. If it counted as a watchdog line,
        # the next check would call the watchdog healthy again.
        self.line(3 * 3600)
        worker.report_watchdog_silence(self.now, self.root)
        self.assertIsNotNone(worker.watchdog_last_run(self.log))
        still_silent = worker.report_watchdog_silence(self.now + 11 * 60, self.root)
        self.assertTrue(still_silent)
        self.assertEqual(len(self.warnings()), 2)
        self.assertTrue((self.root / '.watchdog-silence').exists())
