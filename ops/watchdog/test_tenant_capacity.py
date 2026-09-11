"""The wall must be announced before a customer is standing in front of it."""
import unittest

import watchdog as w


class TenantCapacityTests(unittest.TestCase):
    def test_plenty_of_room_is_quiet(self):
        ok, text = w.tenant_capacity_state(3, 15)
        self.assertTrue(ok)
        self.assertEqual(text, 'laufende Tenants=3/15')

    def test_warns_before_the_ceiling(self):
        ok, text = w.tenant_capacity_state(12, 15)
        self.assertTrue(ok)
        self.assertIn('WARNUNG', text)

    def test_full_turns_the_check_red(self):
        # From here the worker refuses and the next signup queues silently.
        ok, text = w.tenant_capacity_state(15, 15)
        self.assertFalse(ok)
        self.assertIn('VOLL', text)

    def test_over_the_limit_is_also_red(self):
        ok, _ = w.tenant_capacity_state(16, 15)
        self.assertFalse(ok)

    def test_unknown_limit_does_not_invent_a_verdict(self):
        for limit in (None, 0, -1):
            ok, text = w.tenant_capacity_state(3, limit)
            self.assertTrue(ok)
            self.assertIn('Grenze unbekannt', text)


if __name__ == '__main__':
    unittest.main()
