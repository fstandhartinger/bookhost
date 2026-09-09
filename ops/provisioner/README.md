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
login is automated. See the off-host section below for Storage Box replication.

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

Logs are in `tenants/worker.log`, `backup.log`, and `purge.log`. See the Isolation section for the shared proxy-network boundary. SMTP, automatic
upgrades, log rotation and the planned document-review workflow are separate work.

## Off-host backups (Hetzner Storage Box)

`offsite-sync.sh` replicates authenticated `.age` + `.age.hmac` pairs to
`wissen-backups/<slug>/` via rsync/SSH port 23. The existing encrypted archive
already includes `.env` and `docker-compose.yml`; plaintext configuration is
never uploaded. OpenSSL `.enc` fallback archives are not replicated: install
`age` and create a fresh backup before enabling offsite protection.

Configure `/home/flori/ventures2/bookstack/work/.storagebox.env` (0600), outside git:

```sh
STORAGEBOX_HOST=uXXXXX.your-storagebox.de
STORAGEBOX_USER=uXXXXX
STORAGEBOX_SSHKEY=/home/flori/ventures2/bookstack/work/.storagebox_key
```

Use a private SSH key (0600), upload its public key during Storage Box creation,
and enable SSH and external access. Disable Samba and WebDAV. On first use the
script checks the ED25519 host key against Hetzner's independently published
fingerprint and saves it to `work/.storagebox_known_hosts`; later connections
require that key. A mismatch fails closed. For a legitimate provider key change,
verify https://docs.hetzner.com/storage/storage-box/general/#ssh-host-keys before
updating the fingerprint/pin.

```sh
./ops/provisioner/offsite-sync.sh
./ops/provisioner/offsite-restore-test.sh demo
```

Sync logs to `tenants/offsite.log` and exits nonzero if configuration, integrity,
or transport fails. Its global lock prevents concurrent sync/restore operations;
per-tenant locks protect snapshots during copying. Transfers use delayed updates
and never mirror local deletions. Remote timestamped archives and HMAC sidecars
expire after 30 elapsed UTC days, including tenants removed locally. Expiry runs
only after uploads succeed; outages can extend retention until the next success.
Unknown remote files are never removed.

Restore downloads the newest complete remote pair to a private temporary directory,
checks HMAC before decryption, then calls the same isolated `tenant.restore` logic
as `restore-test.sh`. It does not require local tenant files and never replaces the
running tenant. Both download staging and the isolated restore project are cleaned
up. Preserve `work/.backup.key` separately in an operator-controlled off-host secret
store: the Storage Box intentionally does not receive the decryption key. Without
that separately preserved key, host-loss recovery is impossible.

User cron: `30 3 * * * /home/flori/ventures2/bookstack/work/prov-clone/ops/provisioner/offsite-sync.sh >/dev/null 2>&1 # wissen-offsite`.
The script itself writes the log. Do not interpret an installed cron as proof of a
successful remote backup: require a successful sync and remote restore first.

Initial setup 2026-09-08: the project token can read the Storage Box API and BX11
pricing (EUR 3.808 gross/month, no setup fee), but creation returned HTTP 403
`forbidden`. No box was created. Scripts and cron are prepared; actual off-host
protection remains pending. Operator handover and validation are recorded outside
git in `work/offsite-backup-report.md`.

## Public read-only demo

Run `python3 ops/provisioner/demo-publish.py` to reconcile the initialized `demo`
tenant only. It shares the lifecycle lock with backups, refuses a mismatched URL,
updates two books and ten Markdown pages, and reuses the known legacy seed pages.
Unrelated pages are not deleted. All non-admin roles become read/export-only and
per-entity permission overrides are cleared on this dedicated demo. Registration
is disabled; the books homepage and custom-head banner link to Wissen.

Unchanged runs do not update content, revisions, settings or permission tables.
Permission regeneration runs after the transaction because its table truncation
implicitly commits in MariaDB; a pending setting allows retry after failure.
Run tests using `.venv/bin/python -m unittest discover -p 'test_*.py'` from this
folder. Follow live changes with `backup.sh demo` and `restore-test.sh demo`.

BookStack returns a login redirect for disabled registration, but native denied
edit routes redirect to the readable page or homepage; JSON writes return 403.
The reviewed-intake wording in the example is explicitly illustrative, not a
fabricated claim that the provisioner's content passed through actual intake.

## Isolation

Each tenant has a dedicated Docker bridge named `wissen-<slug>-internal` with
`internal: true`. MariaDB joins only that network, has no published host ports,
and explicitly disables Traefik discovery. BookStack joins that network and the
existing external `coolify` network; routing labels explicitly select `coolify`.
Both services use `no-new-privileges:true`, run without privileged mode or added
capabilities, and carry tenant/isolation labels for operator inspection.

This isolates tenant databases, not the public application containers: BookStack
containers can reach each other's HTTP port over `coolify`, as can other members
of that shared bridge. Application authentication and authorization remain
necessary. Labels are metadata, not a firewall. We do not change `coolify`, host
iptables, or its inter-container communication setting. Disabling ICC on a tenant
bridge would also block that tenant's required BookStack-to-MariaDB connection.
These containers share a host kernel and are not a VM-grade security boundary.

The pinned LinuxServer image uses a writable root filesystem: a live read-only
startup fails in s6 at `/run`. With `/run:exec` and `/tmp` tmpfs mounts it starts, but ignores PUID/PGID,
changes the app user to 911:1001, and makes the persisted cache unwritable to
the provisioner/intake UID 1000. This was reproduced on a disposable tenant;
read-only mode therefore requires a separate UID/storage lifecycle migration. `/config` and MariaDB's data directory are
persistent tenant-specific bind mounts. No `read_only: true` claim is made.

New tenants receive this configuration automatically. Existing tenants resume
their saved Compose file until explicitly migrated:

```sh
./ops/provisioner/migrate-network.sh demo
```

Migration takes the tenant lifecycle lock, validates the candidate Compose before
stopping services, preserves images/settings/credentials/data, then runs down/up
without deleting volumes. It verifies application readiness and unchanged content
metadata; errors trigger rollback to the original Compose and restart. Allow a
brief maintenance window. Backups retain their saved configuration; isolated
restore tests always replace its networks with a fresh private network.

Live verification (read-only checks, both tenants must already exist):

```sh
python3 ops/provisioner/verify-network.py demo e2e-iso
```
