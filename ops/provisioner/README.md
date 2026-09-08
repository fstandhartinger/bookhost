# Wissen tenant operations

Run as `flori` on Sandy with passwordless `sudo docker`, Docker Compose, Python
3.11, curl, tar and flock. The existing `coolify` network and Traefik must exist.
No host ports are published. Each tenant has a private internal database network;
only BookStack also joins coolify. No other Coolify resources are modified.

BookStack is pinned to `v26.05.4-ls283` (LinuxServer release checked 2026-09-08:
https://github.com/linuxserver/docker-bookstack/releases/tag/v26.05.4-ls283).
MariaDB 11.4 is pinned by image digest. HTTPS uses the existing `http`/`https`
entrypoints and `letsencrypt` resolver, plus a per-tenant redirect middleware.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./provision.sh demo demo@wissen.app.mintapis.com
python3 seed-demo.py
./backup.sh demo
./restore-test.sh demo
./deprovision.sh demo       # stops stack; preserves data
./provision.sh demo         # resumes; preserves existing credentials
./destroy.sh demo --yes     # permanently deletes data AND backups
./run-worker.sh --once
```

All data is outside git at `/home/flori/ventures2/bookstack/tenants/<slug>`:
`docker-compose.yml`, `.env` (0600), `bookstack/`, `database/`, `backups/`.
Do not print `.env`, docker environment inspections or resolved Compose config.
The initial administrator secret is passed to PHP over stdin and stored as
`BOOKSTACK_ADMIN_PASSWORD`; it is never emitted. Bootstrapping has no public
route until all migrations complete and default credentials are replaced.
Rerunning provision does not reset an existing administrator's password.

The worker reads `DATABASE_URL_LOCAL` from the explicitly configured work
`.app.env`, accepting shell-quoted assignments and `export` without evaluating
shell commands. Schema is in `schema.sql` and shared in `work/tenants-schema.md`.
It claims one row transactionally using `FOR UPDATE SKIP LOCKED`, commits
`provisioning`, then runs the isolated provisioner and saves `running`, URL and
initial password, or a fixed secret-free error. The control plane must enforce
team authorization and atomically clear `initial_password` after showing it once.
`--once` handles at most one tenant; default polls every 30 seconds; `--cron`
polls at 0 and 30 seconds then exits. flock prevents overlapping cron workers.

Installed user cron entries run `run-worker.sh` every minute and `backup-all.sh`
at 03:17 UTC. Logs live in `tenants/worker.log` and `tenants/backup.log` (0600).
The runtime currently points at the dedicated `work/prov-clone` checkout; retain
that checkout or update both cron paths when relocating it.

Backups stop only the selected BookStack container briefly to freeze uploads,
use a transaction-consistent MariaDB dump and archive `/config`, then restart it
in a finally block. Seven **complete** backups are retained, including the app
key and Compose config. Incomplete snapshots lack `.complete` and are ignored.
Stopped tenants are not started by backup. The temporary restore stack has no
public route, imports SQL and files, compares the snapshot's page count using
`entities WHERE type='page'`, checks migrations, and is removed in a finally block.

Measured on 2026-09-08 with `sudo docker stats --no-stream`: BookStack 26.45 MiB,
MariaDB 104.5 MiB idle; each has a hard 512 MiB limit (1 GiB maximum per tenant).
CPU was 0.01% / 0.00%. Reserve startup/traffic headroom. Disk before image pulls:
436G total, 327G used, 88G available (79%); after live tests 330G used, 85G free
(80%). This shared-host delta includes concurrent work.

## Repair and limits

For failure, inspect only the tenant's container state and bounded logs locally
(logs can contain sensitive values; never publish them). Check disk, DNS, database
health, migrations and certificate issuance. Rerun `provision.sh <slug>` after
repair. Set failed rows back to `pending` to retry; for an interrupted worker,
first ensure no worker is active before resetting a stranded `provisioning` row.
There is no automatic lease recovery or rollback of failed tenant data. Never
reset a database merely because migration or network readiness failed.

To restore production manually: deprovision, preserve/move its current data,
extract a known complete archive and restore the saved `.env` and Compose file,
start only db, import `database.sql` with the database credentials through stdin
or its container environment, then start BookStack and verify HTTPS and content.
Use the tested restore script first; destroy is irreversible.

Single host, local backups only: host loss can lose both production and backups.
Off-host encrypted backups, SMTP, mail intake and billing-driven suspension are
not implemented here. The common coolify network is not a strong isolation
boundary between app containers. No capacity admission controller, automatic
upgrades or log rotation are included. Backup downtime and the 512 MiB limits
must be considered for larger tenants. This is provisioning infrastructure,
not implementation of the planned AI review workflow.
