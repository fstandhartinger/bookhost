# Live acceptance — 2026-09-08 UTC

- `df -h /` before: `/dev/md2 436G 327G 88G 79% /`.
- `provision.sh demo demo@wissen.app.mintapis.com`: `RUNNING https://demo.wissen.app.mintapis.com`.
- `curl -sI https://demo.wissen.app.mintapis.com/login`: `HTTP/2 200`, normal certificate verification (no `-k`).
- `python3 seed-demo.py`: `ADMIN VERIFIED: default rejected, generated hash matches; DEMO pages=2`.
  This checks absence of admin@admin.com and Laravel Hash rejection of the old
  password, avoiding automated login as instructed. It creates the book and
  published pages through BookStack's own repositories and permissions logic.
- `backup.sh demo`: complete snapshot at `backups/20260908T221442Z`.
- `restore-test.sh demo`: `RESTORE OK pages=2`; temporary stack/data removed.
- Inserted `e2e-test` as pending, then `run-worker.sh --once`: `Tenant running`.
- SQL verification: `e2e-test | running | https://e2e-test.wissen.app.mintapis.com | initial_password IS NOT NULL = true`.
- `curl -sI https://e2e-test.wissen.app.mintapis.com/login`: `HTTP/2 200`.
- `destroy.sh e2e-test --yes`: `DESTROYED e2e-test`; deleted its tenants row.
- `crontab -l`: minute worker and `17 3 * * *` backup-all entries installed,
  preserving all unrelated entries.
- `sudo docker stats --no-stream wissen-demo-bookstack-1 wissen-demo-db-1`:
  26.45 MiB / 512 MiB and 104.5 MiB / 512 MiB; CPU 0.01% / 0.00%.
- `df -h /` after: `/dev/md2 436G 330G 85G 80% /`.
- Python compile and shell syntax checks passed. Tenant traversal/reserved-slug
  rejection and destructive `--yes` gate checked before release.

Two issues discovered and corrected during live acceptance: initial readiness
must wait for all migrations, and this BookStack version counts pages in
`entities` rather than a legacy `pages` table. The empty demo was recreated
before seeding. Incomplete backup directories are ignored by restore/retention.
