"""A worker log stamped in the future must not read as a live worker."""
import os
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w


class LogAgeTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'worker.log'
        self.now = time.time()
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def write(self, age):
        self.log.write_text('x')
        stamp = self.now - age
        os.utime(self.log, (stamp, stamp))

    def test_normal_age_is_returned(self):
        self.write(42)
        self.assertAlmostEqual(w.log_age(self.log, self.now), 42, delta=1)

    def test_missing_log_is_untrusted(self):
        self.assertIsNone(w.log_age(self.log, self.now))

    def test_small_skew_is_tolerated(self):
        # Rounding and a second of clock drift are normal, not evidence of fraud.
        self.write(-30)
        self.assertIsNotNone(w.log_age(self.log, self.now))

    def test_future_stamp_is_untrusted(self):
        # Otherwise now - mtime stays negative, the "< 180 s" check passes
        # forever, and a worker that died keeps reading as healthy.
        self.write(-3600)
        self.assertIsNone(w.log_age(self.log, self.now))


if __name__ == '__main__':
    unittest.main()
