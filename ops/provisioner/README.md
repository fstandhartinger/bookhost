# Wissen tenant operations

Run as `flori` on Sandy with passwordless `sudo docker`, Compose, Python 3.11,
GNU timeout/setsid, tar, flock, OpenSSL and preferably age. The existing coolify
network and Traefik terminate HTTPS. No host ports are published. Only the selected
tenant's resources are changed. Runtime checkout: `work/prov-clone`.

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
./provision.sh my-team owner@example.com
./backup.sh demo
./restore-test.sh demo
./deprovision.sh demo         # down; retain data, credentials, URL
./provision.sh demo           # up existing Compose; no credentials/seed changes
./destroy.sh my-team          # mark now, stop; 30-day recovery window
./purge.sh my-team            # only deletes when mark is >=30 days old
./destroy.sh my-team --now --yes # irreversible test-only immediate deletion
./run-worker.sh --once
.venv/bin/python -m unittest discover -s . -p 'test_*.py' -v
```

All tenant data is outside git at `/home/flori/ventures2/bookstack/tenants/<slug>`.
Never print `.env`, resolved Compose configs, Docker environment inspection, or
subprocess diagnostics. Initial credentials go through stdin during bootstrap;
public routing is enabled only after default credentials have been replaced.
Pinned images are in `tenant.py`; existing tenants resume their saved Compose.
An incomplete bootstrap requires operator repair; retries never silently reseed.

## Worker contract

`schema.sql` adds `desired_state` idempotently. The worker reads local DB credentials
from `work/.app.env`. Billing sets `desired_state` to `running` or `suspended`;
worker stops suspended targets without clearing URL/data and resumes suspended or
existing pending tenants with `compose up -d`. Resume does not repopulate a consumed
initial password. A change during provisioning is reconciled on the next pass.
New pending slugs use `reserved-slugs.json`, the 3–30 character expression
`^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`, no double hyphens, no `restore` prefix.
The initialized operator demo is grandfathered only for lifecycle management.

Claims set `updated_at`. Provisioning older than 20 minutes is stopped and marked
failed with `timeout`; failed cleanup remains eligible for retry. The worker
releases transactions during commands. `run-worker.sh` holds flock over the whole
run; always use that entry point to prevent concurrent reconciliation. Each run
handles suspensions/validation and at most one start. Direct Python execution is
only appropriate under the same external lock.

A start requires at least 20 GiB available according to df and fewer running
BookStack tenant containers than `MAX_TENANTS` in `limits.env` (default 15).
Capacity deferrals retain pending state and emit one notice per hour across cron
processes. Restores do not count against admission. This is a minimum disk/tenant
admission check, not a complete RAM/storage quota system.

Provision processes use a separate session/process group and a 1100-second
GNU timeout with a 20-second hard-kill grace. Individual external commands have
180-second limits and inherit that process group. Failures/signals run Compose
down, preserving disk data; the worker also cleans up after failed commands.
SIGKILL/power loss is recovered by the stale-provisioning pass.

## Backups, restore, deletion

Backups stop only BookStack briefly, dump MariaDB consistently and archive config,
uploads, .env, saved Compose and content verification metadata. age encrypts the
combined archive with a generated random passphrase; without age, OpenSSL uses
AES-256-CBC/PBKDF2/salt. `work/.backup.key` is generated once with mode 0600 and
must be preserved separately from backups. No passphrase appears in argv or logs.
Both formats have a keyed SHA-256 authentication sidecar checked before restore.
A backup consists of `.age`/`.enc` plus `.hmac`; copy both. Protected plaintext
staging is deleted in finally; crash leftovers are removed after one day.

Restore uses the backed-up Compose/images and a unique temporary project. It
removes public labels/networks/ports, imports the saved dump and app files, checks
page count, book count, book titles and latest page title both before/after startup,
and verifies migrations. Its containers/files are removed afterward. No interactive
login is automated. Host loss remains unprotected: off-host storage is still needed.

Retention is seven elapsed days by UTC backup filename date, independently of
backup count. The daily purge pass applies it even to stopped tenants. Destroy
writes `.destroy_requested_at` without resetting an existing date, plus a durable
`.destroy-requests/<slug>` tombstone that prevents a stale DB row from recreating
a purged tenant. Purge removes tenant files/backups after 30 days. The tombstone
stays; remove it only during an explicit operator-approved recovery/reuse along
with reconciling the tenant DB row. Immediate `--now --yes` is for test fixtures.

User cron (UTC), preserving all unrelated entries:
- Every minute: `run-worker.sh` (polls at 0 and 30 seconds).
- 03:17: `backup-all.sh` (stopped tenants stay stopped).
- 03:40: `purge-all.sh` (retention and matured deletion marks).

Logs are in `tenants/worker.log`, `backup.log`, and `purge.log`. The shared coolify
app network remains a weak isolation boundary. SMTP, off-host backup, automatic
upgrades, log rotation and the planned document-review workflow are separate work.
