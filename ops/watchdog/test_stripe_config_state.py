"""The Stripe configuration check runs daily; its verdict must reach the line."""
import os
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w


class StripeConfigStateTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'stripe-config.log'
        self.now = time.time()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def write(self, text, age=0):
        self.log.write_text(text)
        stamp = self.now - age
        os.utime(self.log, (stamp, stamp))

    def test_missing_log_is_not_ok(self):
        self.assertIn('nie geprueft', w.stripe_config_state(self.log, self.now))

    def test_log_without_a_verdict_says_so(self):
        self.write('OK: irgendwas\n')
        self.assertIn('ohne Ergebniszeile', w.stripe_config_state(self.log, self.now))

    def test_passing_run_reports_its_age(self):
        self.write('OK: alles gut\nEXIT=0\n', age=3 * 3600)
        line = w.stripe_config_state(self.log, self.now)
        self.assertIn('ok', line)
        self.assertIn('3 h', line)

    def test_failing_run_is_named(self):
        self.write('  FEHLT bei Stripe: invoice.paid\nEXIT=1\n')
        self.assertIn('BEANSTANDET', w.stripe_config_state(self.log, self.now))

    def test_only_the_last_verdict_counts(self):
        # Yesterday's failure must not keep shouting after today's pass.
        self.write('EXIT=1\nEXIT=0\n')
        self.assertIn('ok', w.stripe_config_state(self.log, self.now))

    def test_a_stale_log_is_not_reported_as_ok(self):
        self.write('EXIT=0\n', age=40 * 3600)
        line = w.stripe_config_state(self.log, self.now)
        self.assertIn('nicht geprueft', line)
        self.assertNotIn('ok,', line)


if __name__ == '__main__':
    unittest.main()
