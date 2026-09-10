#!/usr/bin/env python3
"""Read-only: what the watchdog log actually says about availability.

The AGB promise 99 % availability per calendar month. The evidence for that
already exists — the watchdog writes one line per check every ten minutes — but
reading the tail of the log only ever shows the present. A two-and-a-half hour
red window on 2026-09-09 sat in the log unnoticed for a day.

Run: python3 availability.py [logfile] [--since YYYY-MM-DD]
"""
import argparse
import collections
import datetime
import re
import sys

LINE = re.compile(r'^(\S+) ([^:]+): (ok|fail)')
SILENCE = 'WAECHTER STUMM'


def read(path, since=None):
    """Return counts per check and the observed window."""
    counts = collections.Counter()
    first = last = None
    gaps = []
    previous = None
    for raw in open(path, errors='replace'):
        if SILENCE in raw:
            continue
        match = LINE.match(raw)
        if not match:
            continue
        stamp, label, status = match.groups()
        try:
            when = datetime.datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if since and when < since:
            continue
        counts[(label.strip(), status)] += 1
        first = when if first is None else min(first, when)
        last = when if last is None else max(last, when)
        if previous is not None and (when - previous).total_seconds() > 1800:
            gaps.append((previous, when))
        previous = when
    return counts, first, last, gaps


def report(counts, first, last, gaps):
    labels = sorted({label for label, _ in counts})
    lines = [f'Zeitraum: {first} bis {last}']
    for label in labels:
        ok = counts[(label, 'ok')]
        bad = counts[(label, 'fail')]
        total = ok + bad
        if not total:
            continue
        lines.append(f'{label:<20} ok={ok:<5} fail={bad:<5} {100 * ok / total:6.2f} %')
    for start, end in gaps:
        lines.append(f'LUECKE ohne Waechterzeile: {start} bis {end}')
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('log', nargs='?',
                        default='/home/flori/ventures2/bookstack/tenants/watchdog.log')
    parser.add_argument('--since', help='YYYY-MM-DD (UTC)')
    args = parser.parse_args(argv)
    since = None
    if args.since:
        since = datetime.datetime.fromisoformat(args.since).replace(
            tzinfo=datetime.timezone.utc)
    print(report(*read(args.log, since)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
