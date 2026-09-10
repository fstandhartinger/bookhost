"""W7/W8: freshness must not be forgeable, and the grace must not renew itself."""
import os
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w


class FirstBackupGraceTests(unittest.TestCase):
    """W8: a workspace without any backup may be excused only while it is new."""

    def test_new_workspace_without_backup_is_excused(self):
        self.assertTrue(w.first_backup_grace(marker_age=5 * 60, tenant_age=5 * 60))

    def test_old_workspace_is_not_excused(self):
        self.assertFalse(w.first_backup_grace(marker_age=90 * 60, tenant_age=90 * 60))

    def test_renewed_marker_on_an_old_workspace_is_not_excused(self):
        # The marker was touched a minute ago, the workspace exists since two
        # days and still has no backup at all. Excusing that hides a customer
        # who has never been backed up.
        self.assertFalse(w.first_backup_grace(marker_age=60, tenant_age=2 * 86400))

    def test_without_a_known_age_the_marker_still_decides(self):
        # Older snapshots carry no creation time; behave as before rather than
        # turning every workspace red.
        self.assertTrue(w.first_backup_grace(marker_age=60, tenant_age=None))
        self.assertFalse(w.first_backup_grace(marker_age=90 * 60, tenant_age=None))

    def test_missing_marker_is_never_excused(self):
        self.assertFalse(w.first_backup_grace(marker_age=None, tenant_age=60))


class ArchiveFreshnessTests(unittest.TestCase):
    """W7: the age of an archive comes from its name, never from a touch."""

    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp()) / 'backups'
        self.dir.mkdir(parents=True)
        self.now = time.time()

    def tearDown(self):
        shutil.rmtree(self.dir.parent, ignore_errors=True)

    def archive(self, name, mtime=None):
        path = self.dir / name
        path.write_bytes(b'x' * w.MIN_BACKUP_BYTES)
        (self.dir / (name + '.hmac')).write_bytes(b'y' * 64)
        if mtime is not None:
            os.utime(path, (mtime, mtime))
        return path

    def named(self, offset):
        return time.strftime('%Y%m%dT%H%M%SZ', time.gmtime(self.now - offset)) + '.age'

    def test_old_archive_touched_today_stays_old(self):
        self.archive(self.named(5 * 86400), mtime=self.now)
        self.assertGreater(w.usable_backups(self.dir, self.now)[0], 4 * 86400)

    def test_future_stamp_does_not_count(self):
        future = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime(self.now + 86400)) + '.age'
        self.archive(future, mtime=self.now + 86400)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_unparsable_name_does_not_count_however_fresh_its_mtime(self):
        # Falling back to the mtime made a touched legacy file look like a
        # backup taken seconds ago.
        self.archive('legacy-backup.age', mtime=self.now)
        self.assertEqual(w.usable_backups(self.dir, self.now), [])

    def test_real_current_archive_counts(self):
        self.archive(self.named(3600))
        ages = w.usable_backups(self.dir, self.now)
        self.assertEqual(len(ages), 1)
        self.assertAlmostEqual(ages[0], 3600, delta=5)
