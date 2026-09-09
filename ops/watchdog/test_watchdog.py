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
        self.assertEqual(events, [None, None, 'failure', 'recovery', None])
        self.assertFalse(state['alerted'])

    def test_transient_failure_is_silent(self):
        self.assertEqual(self.sequence([True, False, True, False, True])[1], [None] * 5)

    def test_initial_failure_and_repeat_incident(self):
        self.assertEqual(self.sequence([False, False, True, False, False])[1],
                         [None, 'failure', 'recovery', None, 'failure'])

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
        self.assertEqual(out.getvalue().count('ausgefallen seit'), 1)
        self.assertEqual(out.getvalue().count('wieder ok seit'), 1)

    def test_message_format(self):
        state, _ = self.sequence([False, False])
        msg = w.message('Test', state, 'failure')
        self.assertTrue(msg.startswith('Wissen: Test ausgefallen seit '))
        self.assertLessEqual(len(msg.splitlines()), 4)
        self.assertIn(str(w.LOG), msg)

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
