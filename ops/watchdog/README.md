# BookHost operational watchdog

`./ops/watchdog/run.sh --dry-run` runs all seven live checks without sending
Telegram or modifying state. `--dry-run --simulate` additionally runs an isolated
healthy → failed → failed → failed → healthy → healthy sequence in memory. Its
TEST recipient is stdout only; exactly one failure and one recovery are printed.
`WATCHDOG_TEST_URL=https://nonexistent.invalid/healthz` can override the health
probe only in dry-run mode. Simulation never changes production state.

Install idempotently as `flori` with `python3 ops/watchdog/install-cron.py`.
Cron runs every ten minutes, marked `# wissen-watchdog`, and appends to
`/home/flori/ventures2/bookstack/tenants/watchdog.log`. The shell runner loads the
login-shell environment (TG_BOT_TOKEN), `/home/flori/ventures2/.env` (TG_CHAT_ID),
and the private `work/.app.env` and `work/.database-tls.env` files. No credentials
belong in this public repository. Requires Python 3.11+, bash, and the existing
host `psql`; no new Python packages.

Checks:

1. Control-plane `/healthz`: HTTP 200, JSON `db: true`, less than five seconds.
2. Public demo `/`: HTTP 200.
3. `/login` for every running tenant: HTTP 200; slugs validated before use.
4. No provisioning row with `updated_at` older than 20 minutes and no pending
   row with `created_at` older than 15 minutes.
5. Every running tenant has an `.age` backup modified less than 26 hours ago;
   `tenants/backup.log` exists and contains no ERROR in the past 24 hours.
6. Root filesystem usage below 90% (including reserved blocks, like `df`);
   `tenants/worker.log` modified less than three minutes ago.
7. No drafting intake item with `updated_at` older than 30 minutes.

Database queries run in an explicit read-only transaction with a statement
limit, through DATABASE_URL_LOCAL using the supplied CA and TLS server name
with `verify-full`. Connection credentials are passed in the subprocess
environment, never command-line arguments. Failures never print raw exceptions,
HTTP bodies, database errors, or API responses. Missing/unreadable data fails
its check; a database failure fails all four dependent checks.

State is stored atomically with private permissions in
`tenants/.watchdog-state.json`, one record per check: observed status, UTC `since`,
consecutive failure count and whether an alert was delivered. An exclusive
nonblocking lock prevents concurrent runs. The first failure is silent; the
second consecutive failed run alerts once. At a ten-minute cadence detection
therefore takes about 10–20 minutes after the incident starts (ten minutes after
its first observation). Only recovery from an alerted failure sends “wieder ok”.
A transient failure is silent. Delivery failures retry next run without marking
an undelivered notification as delivered. State is persisted after each alert.
As with any HTTP sender, a process crash or ambiguous network timeout immediately
after Telegram accepts a message can cause a duplicate on retry; Telegram offers
no idempotency key. Corrupt state fails closed instead of resetting alert history.

The worker now writes a UTC heartbeat after each successful reconciliation,
including idle runs. The backup runner prefixes output with UTC timestamps for
the 24-hour error window. Legacy lines without timestamps conservatively use
log mtime. Backup files themselves, services and database rows are not modified
by the watchdog. No remediation is automatic.

Run unit tests: `python3 -m unittest discover -s ops/watchdog -v`.
Exit status: 0 all checks healthy, 1 a failed check, 2 fatal configuration/state
error. Keep the cron running on nonzero exit; the next observation is needed for
confirmation and recovery.
