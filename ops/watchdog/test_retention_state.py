"""We promise seven-day rotation publicly; the oldest archive is the evidence."""
import unittest

import watchdog as w


class RetentionStateTests(unittest.TestCase):
    def test_no_archive_yet_is_not_a_fault(self):
        ok, text = w.retention_state(None)
        self.assertTrue(ok)
        self.assertIn('keines', text)

    def test_fresh_archives_are_quiet(self):
        ok, text = w.retention_state(3 * 24)
        self.assertTrue(ok)
        self.assertIn('3.0 d', text)

    def test_seven_days_plus_the_daily_run_is_still_fine(self):
        # The run happens once a day, so an archive may briefly exceed the window.
        ok, _ = w.retention_state(7 * 24 + 12)
        self.assertTrue(ok)

    def test_beyond_the_slack_the_promise_is_broken(self):
        ok, text = w.retention_state(9 * 24)
        self.assertFalse(ok)
        self.assertIn('Aufbewahrung greift nicht', text)


if __name__ == '__main__':
    unittest.main()
