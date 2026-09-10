"""The seven-day rotation the terms promise, proven on a fixture.

In production the rule had never been exercised: the oldest archive was one
day old, so nothing was ever due for deletion. This exercises the decision on
an isolated directory. The removal itself is performed by a stub instead of
`sudo rm`, so what is verified here is which entries retention selects — which
is the part the promise depends on.
"""
import datetime
import pathlib
import shutil
import tempfile
import time
import unittest
from unittest.mock import patch

import tenant


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.backups = self.root / 'backups'
        self.backups.mkdir()
        self.removed = []
        patcher = patch.object(tenant, 'run', side_effect=self.fake_run)
        self.addCleanup(patcher.stop)
        patcher.start()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def fake_run(self, args, **kwargs):
        target = pathlib.Path(args[-1])
        self.removed.append(target.name)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)
        return b''

    def named(self, days):
        stamp = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
        return stamp.strftime('%Y%m%dT%H%M%SZ')

    def make(self, name, mtime_days=None):
        path = self.backups / name
        path.write_bytes(b'x' * 100)
        if mtime_days is not None:
            when = time.time() - mtime_days * 86400
            import os
            os.utime(path, (when, when))
        return path

    def remaining(self):
        return sorted(p.name for p in self.backups.iterdir())

    def test_archive_older_than_seven_days_goes_with_its_signature(self):
        old = self.named(10)
        self.make(old + '.age')
        self.make(old + '.age.hmac')
        recent = self.named(2)
        self.make(recent + '.age')
        self.make(recent + '.age.hmac')
        tenant.retention(self.root)
        self.assertEqual(self.remaining(), [recent + '.age', recent + '.age.hmac'])
        self.assertEqual(len(self.removed), 2)

    def test_an_archive_just_inside_the_window_stays(self):
        keep = self.named(6)
        self.make(keep + '.age')
        tenant.retention(self.root)
        self.assertEqual(self.remaining(), [keep + '.age'])

    def test_stale_temporary_file_is_removed_after_a_day(self):
        self.make('.tmp-halffinished', mtime_days=2)
        tenant.retention(self.root)
        self.assertEqual(self.remaining(), [])

    def test_fresh_temporary_file_is_left_alone(self):
        self.make('.tmp-inprogress', mtime_days=0)
        tenant.retention(self.root)
        self.assertEqual(self.remaining(), ['.tmp-inprogress'])

    def test_unparsable_name_falls_back_to_the_modification_time(self):
        self.make('legacy-old.age', mtime_days=30)
        self.make('legacy-new.age', mtime_days=1)
        tenant.retention(self.root)
        self.assertEqual(self.remaining(), ['legacy-new.age'])

    def test_missing_backup_directory_is_not_an_error(self):
        empty = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, empty, True)
        tenant.retention(empty)
        self.assertEqual(self.removed, [])
