"""Offline capacity contracts: no live DB, Docker, or tenant mutation."""
import contextlib
import importlib
import io
import tempfile
import unittest
from collections import namedtuple
from pathlib import Path
from unittest.mock import MagicMock, patch
import worker
import tenant

GiB = 1024**3
Disk = namedtuple('Disk', 'total used free')

class CapacityGuardTests(unittest.TestCase):
    def reconcile(self, percent=82, free=30, status='pending', existing=False, count=1, limits=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            if existing:
                path = root/'customer-team'; path.mkdir()
                for name in ('.initialized', '.env', 'docker-compose.yml'): (path/name).touch()
            db = MagicMock()
            def execute(sql, params=None):
                result = MagicMock()
                result.fetchall.return_value = [('id','customer-team','owner@example.invalid',status,'running',None,None)] if sql.startswith('SELECT n.id') else []
                result.fetchone.return_value = ('id',)
                return result
            db.execute.side_effect = execute
            used = free * percent / (100-percent)
            with patch.object(worker,'ROOT',root), patch.object(worker,'limits',return_value=limits or {}), patch.object(worker,'env_read',return_value={'DATABASE_URL_LOCAL':'mock','APP_URL':'https://customer-team.example.invalid','BOOKSTACK_ADMIN_PASSWORD':'fixture'}), patch.object(worker.psycopg,'connect') as connect, patch('shutil.disk_usage',return_value=Disk((used+free)*GiB,used*GiB,free*GiB)), patch.object(worker.subprocess,'check_output',side_effect=lambda args, **kw: f'Avail\n{free*GiB}\n' if args[0]=='df' else 'wissen-customer-bookstack-1\n'*count), patch.object(worker,'command') as command, patch.object(worker,'store_token'), contextlib.redirect_stdout(io.StringIO()) as log:
                connect.return_value.__enter__.return_value = db
                worker.once()
            return db, command, log.getvalue()

    def test_below_limits_provisions(self):
        db, command, _ = self.reconcile(free=20)
        command.assert_called_once_with('provision','customer-team','owner@example.invalid')
        self.assertTrue(any("SET status='running'" in c.args[0] for c in db.execute.call_args_list))

    def test_percent_and_free_limits_fail_customer_row(self):
        for percent, free in [(86,58),(82,19),(85,30)]:
            with self.subTest(percent=percent,free=free):
                db, command, log = self.reconcile(percent,free)
                command.assert_not_called()
                updates = [c for c in db.execute.call_args_list if "SET status='failed'" in c.args[0]]
                self.assertEqual(len(updates),1)
                self.assertIn('We could not prepare your workspace right now',str(updates[0]))
                self.assertIn('free_GiB=',log)
                self.assertIn('used_percent=',log)

    def test_custom_limits_and_max_tenants(self):
        _, command, _ = self.reconcile(86,25,limits={'MAX_DISK_PERCENT':'88','MIN_FREE_DISK_GB':'24'})
        command.assert_called_once()
        _, command, _ = self.reconcile(count=15)
        command.assert_not_called()

    def test_resume_and_existing_pending_ignore_full_disk_and_tenant_limit(self):
        for status in ('suspended','pending'):
            with self.subTest(status=status):
                _, command, _ = self.reconcile(99,1,status,True,15)
                self.assertIn('provision',[c.args[0] for c in command.call_args_list])

    def test_backup_restore_suspend_dispatch_ignore_capacity(self):
        for action, function in [('backup','backup'),('restore-test','restore'),('deprovision','compose')]:
            with self.subTest(action=action), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); path=root/'customer-team'; path.mkdir()
                with patch.object(tenant,'ROOT',root), patch('shutil.disk_usage',return_value=Disk(100*GiB,99*GiB,GiB)), patch.object(tenant,function) as operation, patch('sys.argv',['tenant.py',action,'customer-team']):
                    tenant.main()
                operation.assert_called_once()

    def test_unavailable_measurement_and_invalid_config_fail_closed(self):
        with patch.object(worker,'disk_state',side_effect=OSError), contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(worker.capacity())
        with patch.object(worker,'limits',return_value={'MAX_DISK_PERCENT':'nan'}), contextlib.redirect_stdout(io.StringIO()):
            self.assertFalse(worker.capacity())

    def test_count_excludes_restore_and_unrelated_containers(self):
        capacity = importlib.import_module('capacity')
        with patch.object(capacity.subprocess,'check_output',return_value='wissen-demo-bookstack-1\nwissen-team-bookstack-1\nwissen-restore-team-bookstack-1\nother-bookstack-1\n'):
            self.assertEqual(capacity.running_tenants(),2)

    def test_report_sizes_and_reserves(self):
        capacity = importlib.import_module('capacity')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for slug in ('alpha','bravo'):
                (root/slug).mkdir(); (root/slug/'docker-compose.yml').touch()
            with patch('shutil.disk_usage',return_value=Disk(110*GiB,82*GiB,18*GiB)), patch.object(capacity,'directory_bytes',side_effect=lambda p: {'alpha':2*GiB,'bravo':5*GiB}[p.name]), patch.object(capacity,'running_tenants',return_value=1):
                report=capacity.report(root,{})
            self.assertEqual(report['used_percent'],82)
            self.assertEqual(report['tenant_count'],2)
            self.assertEqual(report['running_tenants'],1)
            self.assertEqual(report['tenants'][0],{'slug':'bravo','bytes':5*GiB})
            self.assertEqual(report['reserve_warn_gib'],-2)
            self.assertEqual(report['reserve_fail_gib'],8)
            self.assertEqual(report['free_gib'],18)
