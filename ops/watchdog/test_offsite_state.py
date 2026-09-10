"""The offsite copy logs where nobody looks; the watchdog line must say it."""
import os
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w


class OffsiteStateTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'offsite.log'
        self.now = time.time()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, text, age_hours=0):
        self.log.write_text(text)
        stamp = self.now - age_hours * 3600
        os.utime(self.log, (stamp, stamp))

    def test_never_run_is_named(self):
        self.assertEqual(w.offsite_state(self.log, self.now), 'Offsite: nie gelaufen')

    def test_last_run_failed_is_named_with_its_age(self):
        self.write('OFFSITE ERROR Storage Box not configured\n', age_hours=19)
        state = w.offsite_state(self.log, self.now)
        self.assertIn('FEHLER', state)
        self.assertIn('19 h', state)
        self.assertIn('Storage Box not configured', state)

    def test_a_successful_run_is_named_too(self):
        self.write('OFFSITE OK 3 Archive kopiert\n', age_hours=2)
        state = w.offsite_state(self.log, self.now)
        self.assertIn('ok vor 2 h', state)
        self.assertNotIn('FEHLER', state)

    def test_only_the_last_line_decides(self):
        self.write('OFFSITE ERROR alt\nOFFSITE OK neu\n', age_hours=1)
        self.assertIn('ok', w.offsite_state(self.log, self.now))

    def test_empty_log_is_not_silently_fine(self):
        self.write('')
        self.assertEqual(w.offsite_state(self.log, self.now), 'Offsite: ohne Ausgabe')
