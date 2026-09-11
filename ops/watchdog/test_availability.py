"""The summary must count what happened, including what the tail no longer shows."""
import datetime
import pathlib
import shutil
import tempfile
import unittest

import availability as a


class AvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.log = self.dir / 'watchdog.log'

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def write(self, lines):
        self.log.write_text('\n'.join(lines) + '\n', encoding='utf-8')

    def test_counts_ok_and_fail_per_check(self):
        self.write([
            '2026-09-09T19:00:02+00:00 Backups: fail — fehlend: x',
            '2026-09-09T19:10:02+00:00 Backups: ok — keine',
            '2026-09-09T19:10:02+00:00 Demo: ok — HTTP 200',
        ])
        counts, first, last, _, _free = a.read(self.log)
        self.assertEqual(counts[('Backups', 'fail')], 1)
        self.assertEqual(counts[('Backups', 'ok')], 1)
        self.assertEqual(counts[('Demo', 'ok')], 1)
        self.assertLess(first, last)

    def test_a_red_window_in_the_middle_is_not_lost(self):
        # Reading the tail would only ever show the last, green line.
        lines = [f'2026-09-09T{h:02d}:00:02+00:00 Backups: fail — x' for h in range(19, 22)]
        lines.append('2026-09-09T22:00:02+00:00 Backups: ok — keine')
        self.write(lines)
        counts, *_ = a.read(self.log)
        self.assertEqual(counts[('Backups', 'fail')], 3)
        self.assertIn('25.00 %', a.report(*a.read(self.log)))  # 1 gruen auf 3 rot

    def test_silence_warnings_are_not_counted_as_checks(self):
        self.write([
            '2026-09-09T19:00:02+00:00 Backups: ok — keine',
            '2026-09-09T20:00:02+00:00 WAECHTER STUMM — keine Waechterzeile seit 60 Minuten',
        ])
        counts, _, _, gaps, _free = a.read(self.log)
        self.assertEqual(sum(counts.values()), 1)
        self.assertEqual(gaps, [])

    def test_a_gap_without_any_line_is_reported(self):
        self.write([
            '2026-09-09T19:00:02+00:00 Backups: ok — keine',
            '2026-09-09T23:00:02+00:00 Backups: ok — keine',
        ])
        _, _, _, gaps, _free = a.read(self.log)
        self.assertEqual(len(gaps), 1)
        self.assertIn('LUECKE', a.report(*a.read(self.log)))

    def test_since_limits_the_window(self):
        self.write([
            '2026-09-09T19:00:02+00:00 Backups: fail — x',
            '2026-09-10T19:00:02+00:00 Backups: ok — keine',
        ])
        since = datetime.datetime(2026, 9, 10, tzinfo=datetime.timezone.utc)
        counts, *_ = a.read(self.log, since)
        self.assertEqual(counts[('Backups', 'fail')], 0)
        self.assertEqual(counts[('Backups', 'ok')], 1)

    def test_unparsable_lines_are_skipped(self):
        self.write(['kaputt', '2026-09-09T19:00:02+00:00 Backups: ok — keine'])
        counts, *_ = a.read(self.log)
        self.assertEqual(sum(counts.values()), 1)

    def test_disk_trend_shows_the_dip_and_the_recovery(self):
        # A single reading during the nightly dump looked like a collapse and
        # produced a false alarm. The series has to show both ends.
        self.write([
            '2026-09-11T02:30:02+00:00 Host und Worker: ok — Platte=90.0%; frei=45.0 GiB',
            '2026-09-11T03:30:02+00:00 Host und Worker: ok — Platte=92.4%; frei=29.9 GiB',
            '2026-09-11T04:30:02+00:00 Host und Worker: ok — Platte=89.3%; frei=44.3 GiB',
        ])
        text = a.report(*a.read(self.log))
        self.assertIn('Tiefstand 29.9 GiB', text)
        self.assertIn('zuletzt 44.3 GiB', text)
        self.assertIn('Hoechststand 45.0 GiB', text)

    def test_a_real_breach_of_the_floor_is_named(self):
        self.write(['2026-09-11T03:30:02+00:00 Host und Worker: ok — Platte=97.0%; frei=12.5 GiB'])
        self.assertIn('UNTER DER GRENZE', a.report(*a.read(self.log)))

    def test_without_disk_lines_nothing_is_invented(self):
        self.write(['2026-09-11T03:30:02+00:00 Backups: ok — keine'])
        self.assertNotIn('Platte frei', a.report(*a.read(self.log)))
