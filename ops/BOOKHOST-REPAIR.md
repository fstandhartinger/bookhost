# BookHost repair candidate — operational contract

This candidate is **not deployed**. Do not run a checkout/update against the active
`work/prov-clone`. Tenant-host b5ec7f4 and its migrations are out of scope.

## Backup results

`BACKUP ARCHIVE <mode> <path>` means encrypted bytes and their HMAC were persisted.
It is deliberately separate from `BACKUP <mode> <path>`, emitted only after the
cold restart and local running-state/login HTTP checks succeeded. Restart/probe
failure emits `BACKUP ERROR recovery <slug>` and raises; the CLI catches this and
exits 1. The archive/HMAC remain available, and the staging cleanup runs even on
recovery failure. Errors during dumping remain errors, not a cold fallback.

The recovery probe is read-only. **Never reuse `restore_http_probe` here**: that
helper enables `app-public` inside an isolated restored DB. The new probe only
checks Compose running state and curls the existing app's local `/login`; it does
not touch settings, users, DNS, routing, or tenant DB rows. It does not certify
public TLS/proxy availability. Retries are bounded by a 60-second deadline plus
an in-progress existing compose subprocess bound (180s + kill grace).

## Preserve policy separation

Base `b8319ce` already contains the proposed nightly hot-preferred/cold-fallback
policy. This repair does not change backup-all.sh or policy flags. Automatic cold
fallback **is disruptive**, so this whole branch must not be used as an implicit
nightly-policy approval. Active `c1f474d` remains its existing cold nightly mode.
The recovery-only tenant.py delta can be reviewed/backported separately. A future
strict hot-only nightly policy would fail without a new snapshot under sustained
mutation; that backup-availability tradeoff needs its own explicit decision.
Neither quiet-hot acceptance nor this error fix proves universally interruption-
free nightly backup.

## Atomic update alternative (implemented, bootstrap deliberately refused)

`ops/atomic_provisioner.py` switches an existing app-scoped **symlink** to a fully
prepared retained release directory via `os.replace`, under a stable external
app-specific update flock. Both exact full SHAs and clean tracked/untracked status
are required. Unexpected current SHA, candidate/current dirt, non-ops changes,
changed consumer shell launchers/helpers, runtime config differences and a changed
interpreter target fail closed. There is no fetch, checkout, reset, deletion,
container command, scheduler change, or implicit latest-main resolution.

All five current cron consumers resolve their script path physically before
loading Python/helpers:

| Consumer | Launcher |
|---|---|
| worker | ops/provisioner/run-worker.sh |
| nightly | ops/provisioner/backup-all.sh |
| retention/purge | ops/provisioner/purge-all.sh |
| offsite | ops/provisioner/offsite-sync.sh |
| watchdog | ops/watchdog/run.sh |

Retain old release directories indefinitely while they may have readers; never
checkout or edit a published release. Run manual tools from a resolved release
path as well, not a mutable active alias. An in-flight reader then uses old bytes;
a newly resolving reader uses new bytes. Unchanged shell launchers are a hard
precondition, not just a comment. Tests overlap real Bash readers for all five
launcher paths during a switch (inert fixture payloads, not production scripts).
The update flock serializes pointer writers, not tenant operations; consumer
exclusion is provided by retained immutable directories, not `.worker.lock`.

**Current active installation is a real directory, not this layout.** The tool
therefore refuses it without changing anything. Safely bootstrapping retained
immutable releases and an external frozen venv, accounting for already-running
legacy readers, is an unresolved parent integration gate. Do not rename a legacy
live directory into a symlink while assuming `.worker.lock` excludes backups.
Also, c1f474d -> nightly-hot changes backup-all.sh and is deliberately refused by
this updater: nightly policy/bootstrap must be reviewed separately. This is an
implemented/tested atomic strategy, **not a claim that today's active installation
is now safely updatable**.

No updater or fixture script has production authorization. Independent parent
review must inspect the frozen patch and receipts before committing/integrating.
