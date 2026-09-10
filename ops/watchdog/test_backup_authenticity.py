"""A backup that no longer matches its signature is not a backup."""
import hashlib
import hmac
import os
import pathlib
import shutil
import tempfile
import time
import unittest

import watchdog as w

KEY = b'operator-key-for-tests'


class AuthenticityTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp()) / 'backups'
        self.dir.mkdir(parents=True)
        self.now = time.time()

    def tearDown(self):
        shutil.rmtree(self.dir.parent, ignore_errors=True)

    def archive(self, offset=3600, body=None, signature=None):
        name = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime(self.now - offset)) + '.age'
        path = self.dir / name
        path.write_bytes(body if body is not None else b'x' * w.MIN_BACKUP_BYTES)
        tag = signature if signature is not None else hmac.new(
            KEY, path.read_bytes(), hashlib.sha256).hexdigest()
        (self.dir / (name + '.hmac')).write_text(tag)
        return path

    def test_signed_archive_counts(self):
        self.archive()
        self.assertEqual(len(w.usable_backups(self.dir, self.now, KEY)), 1)

    def test_archive_changed_after_signing_does_not_count(self):
        path = self.archive()
        path.write_bytes(b'z' * w.MIN_BACKUP_BYTES)
        self.assertEqual(w.usable_backups(self.dir, self.now, KEY), [])

    def test_wrong_signature_does_not_count(self):
        self.archive(signature='0' * 64)
        self.assertEqual(w.usable_backups(self.dir, self.now, KEY), [])

    def test_signature_from_another_key_does_not_count(self):
        self.archive(signature=hmac.new(b'someone-elses-key', b'x' * w.MIN_BACKUP_BYTES,
                                        hashlib.sha256).hexdigest())
        self.assertEqual(w.usable_backups(self.dir, self.now, KEY), [])

    def test_without_a_key_the_check_stays_where_it_was(self):
        # A missing operator key must not look like a backup failure.
        self.archive(signature='0' * 64)
        self.assertEqual(len(w.usable_backups(self.dir, self.now)), 1)

    def test_missing_key_file_reports_none(self):
        self.assertIsNone(w.backup_key(pathlib.Path('/nonexistent/backup.key')))

    def test_empty_key_file_reports_none(self):
        empty = self.dir / 'empty.key'
        empty.write_bytes(b'')
        self.assertIsNone(w.backup_key(empty))
