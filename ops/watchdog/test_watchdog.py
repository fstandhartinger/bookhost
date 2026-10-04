import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import watchdog as w
import pathlib
import shutil
import datetime as dt


class StateTests(unittest.TestCase):
    def sequence(self, values):
        state, events = None, []
        for i, ok in enumerate(values):
            state, event = w.transition(state, ok, 100000 + i * 600)
            events.append(event)
        return state, events

    def test_second_failure_alerts_once(self):
        state, events = self.sequence([True, False, False, False])
        self.assertEqual(events, [None, None, 'failure', None])
        self.assertEqual(state['since'], w.stamp(100600))

    def test_recovery_once(self):
        state, events = self.sequence([True, False, False, True, True])
        self.assertEqual(events, [None, None, 'failure', None, 'recovery'])
        self.assertFalse(state['alerted'])

    def test_recovery_needs_two_ok_runs(self):
        state, events = self.sequence([True, False, False, True])
        self.assertEqual(events, [None, None, 'failure', None])
        self.assertTrue(state['alerted'])
        state, event = w.transition(state, True, 102400)
        self.assertEqual(event, 'recovery')
        self.assertFalse(state['alerted'])

    def test_fail_between_oks_stays_alerted_without_new_failure(self):
        state, events = self.sequence([True, False, False, True, False, True, True])
        self.assertEqual(events, [None, None, 'failure', None, None, None, 'recovery'])

    def test_transient_failure_is_silent(self):
        self.assertEqual(self.sequence([True, False, True, False, True])[1], [None] * 5)

    def test_legacy_state_without_oks_and_fail_since(self):
        old = {'status': 'fail', 'since': w.stamp(100000), 'failures': 5, 'alerted': True}
        state, event = w.transition(old, True, 100600)
        self.assertIsNone(event)
        self.assertTrue(state['alerted'])
        self.assertEqual(state['fail_since'], w.stamp(100000))
        state, event = w.transition(state, True, 101200)
        self.assertEqual(event, 'recovery')
        self.assertFalse(state['alerted'])

    def test_persistence_across_restart(self):
        first, _ = w.transition(None, False, 100000)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'state.json'
            w.save(path, {'test': first})
            state, event = w.transition(json.loads(path.read_text())['test'], False, 100600)
        self.assertEqual(event, 'failure')
        self.assertEqual(state['since'], first['since'])

    def test_simulation_never_sends(self):
        with patch.object(w, 'send') as send, contextlib.redirect_stdout(io.StringIO()) as out:
            w.simulate()
        send.assert_not_called()
        self.assertEqual(out.getvalue().count('TEST-Empfänger'), 2)
        self.assertEqual(out.getvalue().count('Test-Prüfung failing since'), 1)
        self.assertEqual(out.getvalue().count('OK again since'), 1)

    def test_message_format(self):
        state, _ = self.sequence([False, False])
        msg = w.message('Backups', state, 'failure')
        self.assertTrue(msg.startswith('BookHost: tenant backups failing since '))
        self.assertIn('Cause:', msg)
        self.assertIn(str(w.LOG), msg)
        self.assertNotIn('ausgefallen', msg)

    def test_message_includes_cause_and_english_name(self):
        state, _ = self.sequence([False, False])
        msg = w.message('Host und Worker', state, 'failure', 'Sandy server disk 91.0% full')
        self.assertIn('Sandy server capacity / provisioning worker', msg)
        self.assertIn('Sandy server disk 91.0% full', msg)
        self.assertNotIn('ausgefallen', msg)

    def test_recovery_message_carries_both_times(self):
        state, events = self.sequence([False, False, True, True])
        self.assertEqual(events[-1], 'recovery')
        msg = w.message('Demo', state, 'recovery')
        self.assertIn('public demo (demo.bookhost.co)', msg)
        self.assertIn('OK again since', msg)
        self.assertIn('failing since', msg)
        self.assertIn(w.stamp(100000)[11:16], msg)
        self.assertIn(w.stamp(101200)[11:16], msg)


class SendTests(unittest.TestCase):
    def argv(self, label, event, dry_run=False):
        env = {'WATCHDOG_NOTIFY_DRY_RUN': '1'} if dry_run else {}
        with patch.object(w.subprocess, 'run') as run, patch.dict(os.environ, env):
            run.return_value.returncode = 0
            if not dry_run:
                os.environ.pop('WATCHDOG_NOTIFY_DRY_RUN', None)
            w.send(label, event, 'TEXT')
        return run.call_args[0][0]

    def test_urgent_failure_and_now_recovery(self):
        argv = self.argv('Control-Plane', 'failure')
        self.assertEqual(argv[:2], ['/home/flori/bin/notify', 'urgent'])
        self.assertTrue(argv[2].startswith('🚨 DRINGEND'))
        argv = self.argv('Demo', 'recovery')
        self.assertEqual(argv[:2], ['/home/flori/bin/notify', 'now'])
        self.assertTrue(argv[2].startswith('✅ ERLEDIGT'))

    def test_other_labels_go_to_digest(self):
        for label in ['Backups', 'Host und Worker', 'Dokument-Eingang']:
            for event in ['failure', 'recovery']:
                argv = self.argv(label, event)
                self.assertEqual(argv[:3], ['/home/flori/bin/notify', 'digest', 'bookhost-watchdog'])
                self.assertEqual(argv[3], 'TEXT')

    def test_nonzero_exit_raises(self):
        with patch.object(w.subprocess, 'run', return_value=type('R', (), {'returncode': 1})()):
            self.assertRaises(RuntimeError, w.send, 'Demo', 'failure', 'TEXT')

    def test_dry_run_env_inserts_flag(self):
        argv = self.argv('Backups', 'failure', dry_run=True)
        self.assertEqual(argv[2], '--dry-run')


class HostCauseTests(unittest.TestCase):
    """The host check must say which of its three sub-conditions fired."""

    def host_result(self, percent, worker_age=None):
        from collections import namedtuple
        disk = namedtuple('Disk', 'total used free')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if worker_age is not None:
                log = root / 'worker.log'
                log.write_text('x')
                stamp = time.time() - worker_age
                os.utime(log, (stamp, stamp))
            with patch.object(w, 'ROOT', root), patch.object(w, 'http', return_value=True), \
                 patch.object(w, 'database', return_value={'running': [], 'pending': 0,
                                                           'provisioning': 0, 'drafting': 0}), \
                 patch.object(w.shutil, 'disk_usage',
                              return_value=disk(110 * 1024**3, percent * 1024**3,
                                                (100 - percent) * 1024**3)), \
                 patch.object(w, 'capacity_limits', return_value={}, create=True), \
                 patch.object(w, 'running_tenants', return_value=3, create=True):
                return w.checks()['Host und Worker']

    def test_full_disk_with_healthy_worker_names_the_disk(self):
        host = self.host_result(91, worker_age=10)
        self.assertFalse(host['ok'])
        self.assertIn('91.0%', host['cause'])
        self.assertIn('running normally', host['cause'])

    def test_stale_worker_names_the_worker(self):
        host = self.host_result(50, worker_age=None)
        self.assertFalse(host['ok'])
        self.assertIn('provisioning worker log missing or has a future timestamp',
                      host['cause'])

    def test_old_worker_log_names_the_age(self):
        host = self.host_result(50, worker_age=600)
        self.assertFalse(host['ok'])
        self.assertIn('has not logged for', host['cause'])

    def test_healthy_host_has_no_cause(self):
        host = self.host_result(50, worker_age=10)
        self.assertTrue(host['ok'])


class MainAndCheckTests(unittest.TestCase):
    def test_failed_delivery_retries_and_recovery_does_not_duplicate(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(w, 'ROOT', Path(tmp)), \
             patch('sys.argv', ['watchdog']), contextlib.redirect_stdout(io.StringIO()):
            with patch.object(w, 'checks', return_value={'Demo': {'ok': False, 'detail': 'test'}}), \
                 patch.object(w, 'send', side_effect=RuntimeError) as send:
                w.main()  # first failure
                w.main()  # delivery fails
                self.assertEqual(send.call_count, 1)
                self.assertFalse(json.loads((Path(tmp)/'.watchdog-state.json').read_text())['Demo']['alerted'])
            with patch.object(w, 'checks', return_value={'Demo': {'ok': False, 'detail': 'test'}}), \
                 patch.object(w, 'send') as send:
                w.main()
                w.main()
                self.assertEqual(send.call_count, 1)
            with patch.object(w, 'checks', return_value={'Demo': {'ok': True, 'detail': 'test'}}), \
                 patch.object(w, 'send') as send:
                w.main()
                w.main()
                self.assertEqual(send.call_count, 1)

    def test_dry_run_does_not_touch_state_or_send(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(w, 'ROOT', Path(tmp)), \
             patch('sys.argv', ['watchdog', '--dry-run', '--simulate']), \
             patch.object(w, 'checks', return_value={'Demo': {'ok': True, 'detail': 'test'}}), \
             patch.object(w, 'send') as send, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(w.main(), 0)
            self.assertEqual(list(Path(tmp).iterdir()), [])
            send.assert_not_called()

    def test_backup_error_window_and_legacy(self):
        now = 200000
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'backup.log'
            path.write_text(w.stamp(now-90000) + ' ERROR old\n' + w.stamp(now) + ' BACKUP good\n')
            self.assertFalse(w.recent_backup_errors(path, now))
            path.write_text(w.stamp(now-100) + ' ERROR recent\n')
            self.assertTrue(w.recent_backup_errors(path, now))
            path.write_text('ERROR legacy\n')
            os.utime(path, (now-90000, now-90000))
            self.assertFalse(w.recent_backup_errors(path, now))
            os.utime(path, (now, now))
            self.assertTrue(w.recent_backup_errors(path, now))

    def test_fallbacks_are_counted_but_not_errors(self):
        now=200000
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp) / 'backup.log'
            path.write_text(w.stamp(now-100) + ' BACKUP FALLBACK cold team after 3 hot attempts\n')
            self.assertFalse(w.recent_backup_errors(path, now))
            self.assertEqual(w.recent_backup_fallbacks(path, now), 1)
            path.write_text(w.stamp(now-90000) + ' BACKUP FALLBACK cold old after 3 hot attempts\n')
            self.assertEqual(w.recent_backup_fallbacks(path, now), 0)

    def test_db_outage_fails_all_dependent_checks(self):
        with patch.object(w, 'database', side_effect=RuntimeError), patch.object(w, 'http', return_value=True):
            results = w.checks()
        self.assertEqual(len(results), 7)
        for i in [2, 3, 4, 6]:
            self.assertFalse(results[w.LABELS[i]]['ok'])

    def test_first_backup_deadline_and_error_are_strict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); tenant=root/'fb-hot-test'; (tenant/'backups').mkdir(parents=True)
            (root/'backup.log').write_text('')
            now=time.time()
            (tenant/'.initialized').touch()
            with patch.object(w,'ROOT',root), patch.object(w,'database',return_value={'running':['fb-hot-test'],'provisioning':0,'pending':0,'drafting':0}), patch.object(w,'http',return_value=True), patch.object(w.time,'time',return_value=now):
                result=w.checks()[w.LABELS[4]]
                self.assertTrue(result['ok']); self.assertIn('erstbackup ausstehend',result['detail'])
                os.utime(tenant/'.initialized',(now-40*60,now-40*60))
                result=w.checks()[w.LABELS[4]]
                self.assertFalse(result['ok'])
                (root/'backup.log').write_text(w.stamp(now)+' BACKUP ERROR fb-hot-test\n')
                result=w.checks()[w.LABELS[4]]
                self.assertFalse(result['ok']); self.assertIn('ERROR letzte 24h=True',result['detail'])


if __name__ == '__main__':
    unittest.main()


class UsableBackupTests(unittest.TestCase):
    """A file called something.age is not yet evidence of a backup."""

    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.now = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.timezone.utc).timestamp()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def archive(self, name, size=w.MIN_BACKUP_BYTES, signature=True, sig_size=64):
        path = self.dir / name
        path.write_bytes(b'x' * size)
        if signature:
            (self.dir / (name + '.hmac')).write_bytes(b'y' * sig_size)
        return path

    def test_complete_archive_counts_and_uses_its_name_for_the_age(self):
        self.archive('20260910T110000Z.age')
        ages = w.usable_backups(self.dir, self.now)
        self.assertEqual(len(ages), 1)
        self.assertAlmostEqual(ages[0], 3600, delta=2)

    def test_truncated_archive_does_not_count(self):
        self.archive('20260910T110000Z.age', size=10)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_archive_without_signature_does_not_count(self):
        self.archive('20260910T110000Z.age', signature=False)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_empty_signature_does_not_count(self):
        self.archive('20260910T110000Z.age', sig_size=0)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_directory_named_like_an_archive_does_not_count(self):
        (self.dir / '20260910T110000Z.age').mkdir()
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_old_archive_touched_today_stays_old(self):
        # Copying or touching an old archive gives it a fresh mtime; the name
        # is what says when the backup was taken.
        path = self.archive('20260901T110000Z.age')
        os.utime(path, (self.now, self.now))
        ages = w.usable_backups(self.dir, self.now)
        self.assertGreater(ages[0], 26 * 3600)

    def test_future_timestamp_is_not_a_fresh_backup(self):
        self.archive('20260911T110000Z.age')
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_the_old_rule_would_have_accepted_these(self):
        # The check used to be `glob('*.age')` plus the newest mtime, with no
        # look at size, signature or file type. This test records the gap so it
        # cannot quietly come back.
        (self.dir / '20260910T110000Z.age').mkdir()
        self.archive('20260910T113000Z.age', size=3, signature=False)
        self.assertEqual(len(list(self.dir.glob('*.age'))), 2)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])
