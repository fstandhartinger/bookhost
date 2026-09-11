"""The hourly in-application job leaves no trace of its own; infer it from work."""
import unittest

import watchdog as w


class BackgroundJobTests(unittest.TestCase):
    @staticmethod
    def line(drafting=0, stale=0):
        return w.background_state({'drafting': drafting, 'stale_cleanup': stale})

    def test_a_quiet_system_is_green(self):
        ok, detail = self.line()
        self.assertTrue(ok)
        self.assertIn('aelter als 2 h: 0', detail)

    def test_rows_the_job_should_have_deleted_turn_the_check_red(self):
        ok, detail = self.line(stale=3)
        self.assertFalse(ok)
        self.assertIn('raeumt nicht mehr auf', detail)

    def test_stuck_drafts_are_still_reported(self):
        ok, detail = self.line(drafting=2)
        self.assertFalse(ok)
        self.assertIn('drafting >30min: 2', detail)


if __name__ == '__main__':
    unittest.main()
