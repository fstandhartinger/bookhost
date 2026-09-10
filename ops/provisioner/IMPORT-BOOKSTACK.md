# Importing a customer BookStack

Run on the provisioner host with its existing Python environment (cryptography is
required), Docker sudo access and the existing intake KMS key. The destination
must already be provisioned by `tenant.py`, initialized and running. It may only
contain an unchanged starter handbook or no content. Edited starter content,
recycle-bin content, other entities, images and attachments are rejected.
`demo` and `qa-bookhost-0909` are explicitly protected.

```sh
python ops/provisioner/import-bookstack.py <slug> \
  --sql /secure/customer.sql.gz --files /secure/storage.tar.gz \
  --old-url https://old.example --dry-run

python ops/provisioner/import-bookstack.py <slug> \
  --sql /secure/customer.sql.gz --files /secure/storage.tar.gz \
  --old-url https://old.example
```

The executable also supports a plain `.sql` file. Gzip is detected by content.
Omitting `--old-url` leaves URLs unchanged. Dry-run reads the inputs completely,
checks the destination and archive paths, and prints counts and the plan; it
creates no backup and performs no mutation. Exit status is 1 on failure, including invalid CLI arguments.

## Customer delivery and cutover

1. Agree a write freeze on the source. Keep the source running and retain an
   independent source backup until the customer accepts the migrated instance.
2. Obtain a single-database `mariadb-dump --single-transaction --routines
   --triggers <database>` export (without `--databases`, `CREATE DATABASE` or a
   different `USE` database). Do not send the database password on the command
   line. The dump includes users, password hashes, roles, token hashes and
   settings: transfer and store it as confidential material.
3. Obtain a gzip tar of local public uploads and private attachment files from
   the same frozen source. Supported member layouts are `uploads/...` (or
   `www/uploads/...`) and `files/...`; an optional `bookstack/` prefix is accepted.
   On the tested LinuxServer image, source attachment files are in
   `/config/www/files`, **not** `/config/files`. Standard BookStack's attachment
   location is `storage/uploads/files`. Pack its contents under `files/`.
   Do not include source `.env`, application code, links, devices or unrelated
   configuration. Symlinks, traversal and duplicate destination paths fail
   preflight. An empty archive is valid for a source without uploads.
4. Record source version, base URL, counts (including soft-deleted rows), file
   SHA-256 hashes, login identity and a search phrase. Obtain the customer
   administrator login through the agreed secure channel.
5. Run dry-run and then import. The tool prints an encrypted hot-backup archive
   receipt **before** changing the destination. It uses the lifecycle lock,
   enables maintenance, rechecks starter content, replaces the destination DB,
   runs migrations, installs files, reinstalls intake credentials, rebuilds
   search and permissions, clears caches and resumes service. PHP always runs
   as `1000:1000`. LinuxServer's root-owned maintenance directory is made writable
   for that UID after the backup. Attachment files live under `/config/files`,
   with `/config/www/files` pointing there, so runtime and backup paths agree.
6. Check all counts, image and attachment downloads/hashes, the customer's
   administrator and member logins, custom roles, representative page links,
   search results and `GET /api/books` with the destination intake token. Only
   then arrange the customer's DNS/cutover and eventual source shutdown.

The admin password after import is the **customer's existing password**, not
BookHost's initial password. The initial `.env` admin values are not imported
credentials. Do not hand them out as a migration login.

## Intake continuity without control-plane writes

`ensure_token(..., reinstall=True, locked=True)` recreates the service token in
the imported DB using the destination's existing ID/secret, and saves encrypted
values to the tenant `.env` through the existing helper. This is a deliberate
reinstallation, not credential rotation: rotating would invalidate the stored
control-plane credential and violate the no-control-plane-write requirement.
If the destination has no token, a new pair is generated and stored in `.env`;
such a destination still needs its normal onboarding to connect intake to the
control plane. This tool never connects to that database.

Source users and custom roles survive. If the source has no BookHost intake
service user, reinstallation adds one, so the resulting user count is source
count plus one. The tool reports raw counts, including the public user and
soft-deleted entities. Source tokens for customer users are retained.

## Recovery and limits

On failure after SQL import begins, the tool authenticates and decrypts the hot
backup, restores the destination DB, full BookStack files and `.env`, removes
maintenance and checks local login readiness. It does not call `tenant.restore`,
which only tests a backup in a separate disposable tenant. Before SQL import,
failures only remove maintenance and retain the live original target. If recovery
fails, it attempts to stop BookStack and reports the backup archive for operator
recovery. Do not retry against a nonempty or unresolved tenant.

The verified fixture uses BookStack v26.05.4 / LinuxServer ls283 and MariaDB 11.4.
Migration of older schemas is invoked but very old releases, MySQL-to-MariaDB
edge cases, huge dumps, views/custom SQL, non-UTF-8 dumps and interrupted host or
Docker failures are not qualified. SQL is currently buffered in memory and uses
the existing 180-second command deadline. Process kill/power loss cannot run
Python recovery; retain the printed backup and inspect maintenance state before
bringing the destination online.

LDAP/SAML/OIDC, SMTP overrides, remote S3 storage, plugins, themes and other
source environment settings are outside this import. The source APP_KEY is not
copied: MFA and other app-key-encrypted settings may need customer recovery.
This is a trusted, operator-reviewed database restore, not a sandbox for hostile
SQL. Supply dumps made with the source DB account, without server-wide commands.

URL rewriting checks the live schema and handles legacy pages/books/chapters as
well as current `entity_page_data` and `entity_container_data`. It also rewrites
image URLs so image API responses do not point back at the old host. Counts are
replaced URL occurrences, including image URL fields. Host-prefix lookalikes are
not replaced. Historical revisions, comments, external-attachment links and
other arbitrary settings are not rewritten. Omitting the old URL deliberately
leaves even image URLs unchanged.
