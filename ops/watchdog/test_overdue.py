"""W5: a row we cannot time is a row we cannot call healthy."""
import pathlib
import unittest

import watchdog as w


class OverdueTests(unittest.TestCase):
    def test_counts_a_row_that_has_been_stuck_too_long(self):
        self.assertIn("< now()-interval '20 minutes'", w.overdue('updated_at', 20))

    def test_counts_a_row_without_any_timestamp(self):
        # The schema allows NULL (default now(), no NOT NULL), and NULL never
        # satisfies `<`, so such a row used to be invisible.
        self.assertIn('updated_at IS NULL', w.overdue('updated_at', 20))

    def test_counts_a_row_stamped_in_the_future(self):
        # A future timestamp postpones detection for as long as the clock is wrong.
        self.assertIn('updated_at > now()', w.overdue('updated_at', 20))

    def test_the_three_conditions_are_an_or(self):
        sql = w.overdue('created_at', 15)
        self.assertTrue(sql.startswith('(') and sql.endswith(')'))
        self.assertEqual(sql.count(' OR '), 2)
        self.assertNotIn('AND', sql)

    def test_every_overdue_check_in_the_query_carries_all_three(self):
        # Resolve next to this file: the release self-test runs discover from
        # the checkout root, not from this directory.
        source = pathlib.Path(__file__).with_name('watchdog.py').read_text(encoding='utf-8')
        for token in ('@OVERDUE_PROVISIONING@', '@OVERDUE_PENDING@', '@OVERDUE_DRAFTING@'):
            self.assertIn(token, source)
            self.assertIn(f"replace('{token}'", source)
