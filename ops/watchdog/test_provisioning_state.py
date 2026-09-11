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
        self.assertEqual(detail, 'überfällig: provisioning=0, pending=0'
                         '; Testphase ohne Erinnerung: keine'
                         '; Bezahlung beendet, Workspace laeuft weiter: keine'
                         '; Kuendigungen offen >24 h: keine')

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


class UnremindedTrialTests(unittest.TestCase):
    """A trial must not run out while nobody told the customer."""

    def base(self, **extra):
        state = {'provisioning': 0, 'pending': 0, 'stranded': [], 'unsuspended': [],
                 'cancellations': []}
        state.update(extra)
        return state

    def test_no_trial_about_to_end_is_reported_as_none(self):
        ok, detail = w.provisioning_state(self.base())
        self.assertTrue(ok)
        self.assertIn('Testphase ohne Erinnerung: keine', detail)

    def test_a_trial_without_a_notice_fails_the_check_and_is_named(self):
        ok, detail = w.provisioning_state(self.base(unreminded=['Acme handbook']))
        self.assertFalse(ok)
        self.assertIn('Acme handbook', detail)

    def test_it_does_not_mask_the_other_findings(self):
        ok, detail = w.provisioning_state(self.base(stranded=['s1'], unreminded=['t1']))
        self.assertFalse(ok)
        self.assertIn('GESTRANDET', detail)
        self.assertIn('t1', detail)


class OpenCancellationTests(unittest.TestCase):
    """The receipt promises two working days; an open row is a broken promise."""

    def base(self, **extra):
        state = {'provisioning': 0, 'pending': 0, 'stranded': [], 'unsuspended': [],
                 'unreminded': [], 'cancellations': []}
        state.update(extra)
        return state

    def test_nothing_open_is_green(self):
        ok, detail = w.provisioning_state(self.base())
        self.assertTrue(ok)
        self.assertIn('Kuendigungen offen >24 h: keine', detail)

    def test_an_open_request_fails_the_check_and_names_it(self):
        ok, detail = w.provisioning_state(self.base(cancellations=[17]))
        self.assertFalse(ok)
        self.assertIn('17', detail)

    def test_it_does_not_hide_the_other_findings(self):
        ok, detail = w.provisioning_state(self.base(stranded=['s1'], cancellations=[4]))
        self.assertFalse(ok)
        self.assertIn('GESTRANDET', detail)
        self.assertIn('Kuendigungen offen', detail)


class BillingStoppedButRunningTests(unittest.TestCase):
    """The order itself never being updated is invisible to the other checks."""

    def base(self, **extra):
        state = {'provisioning': 0, 'pending': 0, 'stranded': [], 'unsuspended': [],
                 'unreminded': [], 'cancellations': [], 'unpaid_running': []}
        state.update(extra)
        return state

    def test_quiet_system_says_nothing_about_it(self):
        ok, detail = w.provisioning_state(self.base())
        self.assertTrue(ok)
        self.assertIn('Bezahlung beendet, Workspace laeuft weiter: keine', detail)

    def test_a_cancelled_customer_still_running_is_named_and_red(self):
        ok, detail = w.provisioning_state(self.base(unpaid_running=['acme-wiki']))
        self.assertFalse(ok)
        self.assertIn('Bezahlung beendet', detail)
        self.assertIn('acme-wiki', detail)

    def test_it_does_not_mask_the_other_findings(self):
        ok, detail = w.provisioning_state(
            self.base(unpaid_running=['a'], cancellations=[9], stranded=['s']))
        self.assertFalse(ok)
        for needle in ('Bezahlung beendet', 'Kuendigungen offen', 'GESTRANDET'):
            self.assertIn(needle, detail)
