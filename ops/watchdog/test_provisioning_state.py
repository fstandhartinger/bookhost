"""A customer whose workspace never came up must not disappear from the report."""
import unittest

import watchdog as w


def snapshot(**overrides):
    base = {'provisioning': 0, 'pending': 0, 'stranded': [], 'unsuspended': []}
    base.update(overrides)
    return base


class ProvisioningStateTests(unittest.TestCase):
    def test_quiet_system_is_green(self):
        ok, detail = w.provisioning_state(snapshot())
        self.assertTrue(ok)
        self.assertEqual(detail, 'überfällig: provisioning=0, pending=0')

    def test_overdue_work_stays_red(self):
        self.assertFalse(w.provisioning_state(snapshot(provisioning=1))[0])
        self.assertFalse(w.provisioning_state(snapshot(pending=2))[0])

    def test_failed_tenant_of_a_paying_customer_is_red_and_named(self):
        # Before this the row left every list and the report went green again.
        ok, detail = w.provisioning_state(snapshot(stranded=['acme-ltd']))
        self.assertFalse(ok)
        self.assertIn('GESTRANDET', detail)
        self.assertIn('acme-ltd', detail)

    def test_workspace_that_should_be_suspended_but_still_runs_is_red(self):
        ok, detail = w.provisioning_state(snapshot(unsuspended=['lapsed-team']))
        self.assertFalse(ok)
        self.assertIn('lapsed-team', detail)

    def test_several_tenants_are_all_named(self):
        ok, detail = w.provisioning_state(snapshot(stranded=['a', 'b'], unsuspended=['c']))
        self.assertFalse(ok)
        for slug in ('a', 'b', 'c'):
            self.assertIn(slug, detail)

    def test_missing_keys_do_not_crash_an_older_snapshot(self):
        ok, _ = w.provisioning_state({'provisioning': 0, 'pending': 0})
        self.assertTrue(ok)
