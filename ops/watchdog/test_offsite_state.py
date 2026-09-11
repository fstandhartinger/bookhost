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
        # Deliberately not the "not configured" message: that one is an open
        # gate waiting on a destination decision, and has its own line.
        self.write('OFFSITE ERROR connection closed by remote host\n', age_hours=19)
        state = w.offsite_state(self.log, self.now)
        self.assertIn('FEHLER', state)
        self.assertIn('19 h', state)
        self.assertIn('connection closed by remote host', state)

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


class OffsiteNotConfiguredTests(unittest.TestCase):
    """A gate nobody opened yet must not read like a system that broke."""

    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'offsite.log'
        self.now = time.time()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def test_missing_destination_is_named_as_an_open_gate(self):
        self.log.write_text(
            'OFFSITE ERROR Storage Box not configured: work/.storagebox.env missing\n')
        line = w.offsite_state(self.log, self.now)
        self.assertIn('nicht eingerichtet', line)
        self.assertNotIn('FEHLER', line)

    def test_a_real_failure_is_still_reported_as_one(self):
        # The distinction must not swallow an actual incident.
        self.log.write_text('OFFSITE ERROR connection refused\n')
        line = w.offsite_state(self.log, self.now)
        self.assertIn('FEHLER', line)
        self.assertNotIn('nicht eingerichtet', line)
