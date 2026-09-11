#!/usr/bin/env python3
"""Mark a cancellation request as dealt with, so the watchdog stops naming it.

The form records a request and the receipt promises the customer that we act
within two working days. The watchdog reports any request still open after 24
hours — but migration 033 added handled_at without giving anyone a way to set
it, so the only ways to silence a correct alarm were raw SQL or deleting the
customer's request. This is that missing way.

Usage:  ops/handle-cancellation.py --list
        ops/handle-cancellation.py <id> "portal cancellation done, confirmed by mail"

Needs DATABASE_URL (and the TLS variables) in the environment, like the other
database tools here. Read-only unless an id is given.
"""
import argparse
import os
import subprocess
import sys


def psql(sql, **variables):
    """Run one statement. Values go through psql variables, never string joins."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("FEHLER: DATABASE_URL fehlt (source ../.env, work/.app.env, work/.database-tls.env)")
    command = ["psql", "-At", "-q", url]
    for name, value in variables.items():
        command += ["-v", f"{name}={value}"]
    # Through stdin, not -c: psql substitutes :variables while reading a script,
    # which keeps the values out of the statement text.
    command += ["-f", "-"]
    result = subprocess.run(command, input=sql, capture_output=True, text=True)
    if result.returncode:
        sys.exit("FEHLER: " + result.stderr.strip())
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("id", nargs="?", type=int, help="id of the request")
    parser.add_argument("note", nargs="?", default="", help="what was done")
    parser.add_argument("--list", action="store_true", help="show open requests")
    args = parser.parse_args()

    if args.id is None or args.list:
        rows = psql(
            "SELECT id||'  '||created_at::timestamp(0)||'  '||kind||'  '||email "
            "FROM cancellation_requests WHERE handled_at IS NULL ORDER BY created_at"
        )
        print(rows if rows else "keine offenen Kuendigungen")
        return 0

    if not args.note:
        sys.exit("FEHLER: bitte kurz festhalten, was getan wurde (zweites Argument)")
    updated = psql(
        "UPDATE cancellation_requests SET handled_at=now(), handled_note=:'note' "
        "WHERE id=:id AND handled_at IS NULL RETURNING id",
        note=args.note, id=args.id,
    )
    updated = updated.strip()
    if not updated or not updated.isdigit():
        sys.exit("FEHLER: id %d gibt es nicht oder sie war schon erledigt" % args.id)
    print("Kuendigung %s als erledigt vermerkt." % updated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
