# Wissen control plane

Next.js 15 App Router, TypeScript, Tailwind, locally served Inter, Auth.js v5 (JWT), PostgreSQL and Stripe. Node 22; port 3000. The public website and team dashboard manage a hosted BookStack subscription and submit a tenant to an external provisioner. BookStack provisioning runs in the external worker. The control plane now supports reviewed document intake at `/app/intake` (beta).

## Run

Install with `npm ci`. Load environment variables from an external secret store, then run `npm run migrate` and `npm run dev`. Production: `npm run build` and `npm start`. Docker runs migrations automatically before starting the standalone server.

```sh
npm run lint
npm test
npm run build
docker build -t wissen-cp:dev .
docker run --rm -p 127.0.0.1:3999:3000 --env-file /secure/path/runtime.env wissen-cp:dev
```

`GET /healthz` pings PostgreSQL and returns 200 with `{"ok":true,"db":true}`, or 503 on failure. The runtime is unprivileged and includes curl for health checks.

## Runtime environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL/PgBouncer connection URI reachable from the container; never use container loopback for the host DB. |
| `DATABASE_SSL_CA_BASE64` | Base64-encoded PEM CA/certificate for a private PostgreSQL CA. Required with Sandy's current PgBouncer certificate. Certificate verification remains enabled. |
| `DATABASE_SSL_SERVERNAME` | Expected TLS certificate hostname, when different from the connection address. Required with Sandy's current PgBouncer certificate. |
| `AUTH_SECRET` | High-entropy secret for Auth.js JWT encryption and verification tokens; keep stable across instances. |
| `AUTH_URL` | Canonical external origin including scheme; production is `https://wissen.app.mintapis.com`. Also used for all billing/auth redirects. |
| `TRUST_PROXY` | Defaults to `true` in Docker behind Traefik; otherwise unset/false. Trusts only the last X-Forwarded-For entry. Proxy must overwrite/append the actual peer IP and container ports must not be publicly reachable. Without it, use socket address or proxy-overwritten x-real-ip; missing/invalid IP returns 400 on limited endpoints. |
| `AUTH_TRUST_HOST` | Set `true` behind the trusted reverse proxy. The proxy must overwrite forwarded host/protocol/IP headers. |
| `STRIPE_SECRET_KEY` | Server-side Stripe secret API key. Never exposed to the browser. |
| `STRIPE_PRICE_TEAM` | Existing monthly Team price ID. The displayed price is the static €39 constant. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook`. |
| `STRIPE_PORTAL_CONFIG` | Optional dedicated billing portal configuration ID; otherwise Stripe's default is used. |
| `AUTH_GOOGLE_ID` | Optional Google OAuth client ID. Google is shown only when both Google values exist. |
| `AUTH_GOOGLE_SECRET` | Optional Google OAuth secret. Callback: `/api/auth/callback/google`. |
| `SMTP_HOST` | SMTP host; email sign-in is enabled when this and SMTP_FROM are present. |
| `SMTP_PORT` | SMTP port, default 587; 465 enables implicit TLS. |
| `SMTP_USER` | SMTP user, if the relay requires authentication. |
| `SMTP_PASS` | SMTP password, paired with SMTP_USER. |
| `SMTP_FROM` | Sender identity for magic-link and password-reset messages. |
| `NEXTAUTH_URL` | Legacy fallback for AUTH_URL; prefer AUTH_URL and do not set contradictory values. |
| `NODE_ENV` | `production` for deployment (set in Docker). |
| `PORT` | Listen port, default 3000 (set in Docker). |
| `HOSTNAME` | Bind address, `0.0.0.0` in Docker. |
| `NEXT_TELEMETRY_DISABLED` | `1` in Docker; disables Next telemetry. |

`DATABASE_URL_LOCAL` is an operator-side convenience for host tools only; it is not read by the application. `STRIPE_PUBLISHABLE_KEY` and `STRIPE_PRODUCT_TEAM` are not needed by this server-hosted Checkout integration. Do not pass them to the frontend.

Do not mix URL `sslmode` options with `DATABASE_SSL_CA_BASE64`, since node-postgres URL parsing can override the explicit SSL options. Publicly trusted database TLS can instead use a correctly configured connection URI.

## Authentication and billing

- New customers start Stripe Checkout with a 14-day trial and no required card. A missing payment method cancels the subscription at trial end. Adding a payment method allows Stripe to charge at the trial end; there is no separate paid-order confirmation flow in this implementation.
- The start endpoint stores a hash of a random HttpOnly browser nonce. `/welcome` retrieves the session directly from Stripe, checks completion, the venture marker and browser binding, and consumes the session once inside a DB transaction. It emits an Auth.js-compatible encrypted JWT and redirects to `/app`.
- An unverified email supplied to Checkout cannot authenticate an existing account. Existing users must first sign in; this is an intentional security constraint. A new Checkout account's email is not marked verified. Checkout first-login is not an identity-verification service.
- Completed new-user checkout webhook processing and welcome processing share a transaction lock. Duplicate webhook IDs are ignored atomically. Subscription changes retrieve current Stripe state, so delayed updates do not overwrite newer state. Missing-team events are harmless; checkout/welcome fetches the current subscription again.
- Checkout JWTs initially last seven days (Auth.js refresh can extend expiry); immutable `auth_time` limits first password setup for unverified email to the first 15 minutes after login. Verified addresses may set a first password later. Password set/change/reset sends a notification when SMTP is configured; provider/password sessions last 30 days; magic links last 15 minutes. Password sign-in is always available. Set the first dashboard password after checkout at `/app?setup=password`; changes require the current password and revoke other sessions while renewing the current cookie. Password login neither verifies email nor revokes sessions. Argon2id hashes use 19 MiB memory, two iterations and one lane; passwords require 10–1024 characters.
- `/login/reset` sends single-use, SHA256-hashed reset tokens valid for 30 minutes when SMTP is configured. Reset revokes all sessions and requires a fresh login. Without SMTP the page directs users to support. Delivery errors are logged generically, and account existence is not disclosed. Development logs magic links explicitly; never forward development logs to a shared service.
- Google does not silently link an existing email account. Sign in with the original email method first. Production email needs configuring before launch for durable return access.
- Checkout session URLs and callback query strings are bearer-like sensitive data. Redact them in proxy/access logs; responses are not logged by this app.
- Checkout is limited to 15 attempts per caller per hour; magic-link email to 5 per recipient per hour. Password login is limited to 10 attempts per normalized email + IP and 30 failures per normalized account per 15 minutes (HTTP 429 once exhausted); password changes and reset requests are also throttled. Configure trusted proxy IP headers: the final `x-forwarded-for` entry must be set by the trusted proxy. A single server process removes expired `password_reset_tokens` and `rate_limits` at startup and hourly through Next instrumentation. Run one app process per deployment. Clean abandoned `checkout_attempts` periodically; verification tokens are cleaned on creation. Reset mail runs after the response via Next `after`, so SMTP latency cannot disclose account existence.

Stripe reference: [no-card trials](https://docs.stripe.com/payments/checkout/free-trials). Auth reference: [Auth.js](https://authjs.dev/). Dependency lockfile pins the installed versions.

## Tenant contract

`db/migrations/002_tenants.sql` reproduces the provisioner's table contract exactly. An additional partial unique index enforces one tenant per team. Requests require an active or unexpired trial subscription and owner authentication. Reserved addresses are rejected before insert, and uniqueness is also enforced in PostgreSQL.

The provisioner owns transitions from `pending` to `provisioning`, `running`, `failed` or `suspended`. The dashboard polls every 15 seconds while pending/provisioning. It does not display raw provisioner errors, which may contain operational details.

The initial password is selected only by a separate owner-authenticated POST. A row lock ensures only one response gets it; the database value is deleted in that transaction. It never appears in HTML/server component payloads. If delivery fails after deletion, reset it in BookStack or through support. This intentionally favors one-time handling over repeated recovery of a plaintext password.

## Publication checks

This repository has not been deployed. The supplied German legal documents contain explicit completion fields; they are drafts until the operator resolves them. The landing page clearly describes reviewed intake and AI answers as planned, not available functionality.

Before public launch:

- Complete legal/operator fields and review the supplied terms. Persist customer-specific AVV acceptance and provide durable contract confirmations. Consumer public cancellation/withdrawal forms described in the draft terms are not implemented by this task; the app has an authenticated Stripe portal and support links only.
- Align the terms' separate paid-order wording with the requested Stripe subscription trial behavior, which starts billing if a payment method is added.
- Confirm tax collection. The existing price is exclusive of tax; this requested Checkout does not enable automatic tax or attach tax rates. The price label alone does not collect VAT.
- Configure SMTP or Google and exercise real email delivery / OAuth. Password return login is available independently; reset delivery is covered with a mocked SMTP transport until SMTP is configured.
- Deploy through the operator and verify the live webhook, TLS and proxy header handling. This local acceptance test only creates, then expires, an unpaid live Checkout session.
- Confirm actual provisioning, tenant isolation, backup retention and successful restore independently. The control plane does not verify those external services and does not promise already-tested restores.
- Enable document intake only after migration 010, KMS/Chutes configuration and tenant API bootstrap below. Email intake and AI answers remain outside this slice.

Legal Markdown comes from `content/legal`; raw HTML is not enabled. Relative legal-document links are normalized and GFM tables are supported.


## Reviewed document intake (Phase 2, Slice 1)

Running workspaces have a **Document intake (beta)** dashboard link. Team members
can upload PDF, DOCX, UTF-8 Markdown or TXT, select a BookStack book/chapter, and
request an AI page suggestion. Owners/admins review the rendered HTML and tags,
edit the title/HTML, and explicitly publish a normal page. Members can read and
reject drafts; publication always checks the current membership role on the server.
All list/item/target access is scoped to the member's tenant and team; unrelated
teams receive 404. Books/chapters come from the tenant API with pagination.

Limits: 10 MB per file, 60,000 extracted characters, 30 upload requests per user
and 60 per team per hour. Original files are held in memory for extraction only;
PostgreSQL stores extracted text and review data. Empty/scanned/encrypted or invalid
files fail clearly. OCR and email intake are outside this slice. PDF/DOCX parsers
run server-side. Next.js keeps `pdf-parse`/`pdfjs-dist` external and explicitly traces
the worker/native canvas assets into the standalone runtime; keep this configuration
when changing the deployment. The HTML allowlist removes scripts, images, links and attributes
both before storage/publication and in the preview.

### New environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `INTAKE_KMS_KEY` | Yes, app and worker | 32 random bytes encoded as 64 hex characters; AES-256-GCM key. Keep stable and back it up separately from the database. |
| `CHUTES_API_KEY` | Yes, app | Chutes server-side inference credential. Never expose as a public variable. |
| `INTAKE_MODELS` | Optional, app | Comma-separated fast models (at most two). Default: `google/gemma-4-31B-turbo-TEE,deepseek-ai/DeepSeek-V3.2-TEE`. Verify availability against Chutes `/v1/models` before changing. |
| `BOOKSTACK_API_ID` / `BOOKSTACK_API_SECRET` | Generated tenant files only | Both values in `tenants/<slug>/.env` are encrypted `v1:` envelopes, not directly usable API credentials. |
| `INTAKE_LIVE_CHECK` | Test only | Set to `demo` to explicitly enable the operator acceptance script. Not needed at runtime. |

Apply migrations `010_intake.sql` and `011_intake_limits.sql` with `npm run migrate` **before deploying the new
worker**. Install `ops/provisioner/requirements.txt` into its existing `.venv`.
Generate the key once outside the repository, for example:

```sh
# Do not overwrite an existing key. Never print or commit its contents.
python3 - <<'PYKEY'
import os, secrets
fd = os.open('/home/flori/ventures2/bookstack/work/.intake.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('INTAKE_KMS_KEY=' + secrets.token_hex(32) + '\n')
PYKEY
```

Load that file into the app runtime (`set -a; source /secure/path/.intake.env;
set +a`). The host worker reads `INTAKE_KMS_KEY` from its environment or the
operator file `/home/flori/ventures2/bookstack/work/.intake.env`. The worker invokes
the same token bootstrap as `ops/provisioner/bookstack-api-token.sh <slug>` after
successful provision/resume and before marking the tenant running. Run this script
once for existing tenants such as `demo`. It creates the passwordless system user
`Wissen Intake` (`system_name=wissen-intake`) and a dedicated role with only
`access-api`, `book-view-all`, `chapter-view-all`, `page-view-all`,
`page-create-all`, and `page-update-all`. Intake is a **team-wide** shared inbox:
all Control-Plane members can read these destinations and drafts; only owners/admins
can publish. Individual BookStack user ACLs are not mirrored; use the service role's
book permissions to restrict destinations. The user has an empty password and a
non-deliverable internal email, with no admin, settings, users, roles or delete rights.

`bookstack-api-token.sh --rotate <slug>` deletes earlier service tokens and the old
legacy intake token, creates fresh credentials, then stores encrypted local values
atomically and updates `tenant_secrets`. Normal resume checks the stored token's
service-user association and a real `GET /api/books?count=1`: a valid token is reused;
a revoked/expired token is replaced with fresh credentials, never resurrected.
Network errors fail intake preparation without stopping a healthy tenant. Explicit
rotation is operator-authorized reissuance. Both encrypted stores use a random
12-byte nonce and tenant-slug AAD, in `v1:` base64(nonce + ciphertext + 16-byte tag).

Do not simply replace the KMS key: existing credentials must first be decrypted
with the old key and re-encrypted with the new one in both stores. Keep the old key
until the new deployment and backups are verified. No key rotation UI is included.

### Review state and failures

`queued → drafting → draft → approved → published`; drafts can be rejected.
Upload streams multipart to a private temporary directory (10 MB file and bounded
body/fields, 30-second read deadline). Tenant authorization comes from the `tenant`
query parameter before reading the body. A process-wide gate admits at most two
uploads/extractions/model jobs; further requests receive 429 with `Retry-After: 30`.
The response is `202 {id,status:"queued"}`; the UI polls every two seconds. This
in-process worker requires a persistent Node server, not a request-only serverless
runtime. Each parser child has a 256 MB V8 heap limit and is killed after 20 seconds;
DOCX entries, actual decompression (20 MB) and XML entities are checked, and PDFs
are limited to 200 pages. Temporary files are removed when work ends; stale crash
files are removed after 30 minutes by the startup/hourly cleanup.

Migration `011_intake_limits.sql` adds atomic per-team quotas: **20 lifetime trial
attempts**, or **300 attempts per UTC calendar month** while active. Reservations,
including failed processing and model fallback, consume one draft; there is no
automatic refund. Remaining allowance appears in the UI; exhaustion returns 402
with billing-portal guidance. Teams must have a running tenant, running desired
state and active or unexpired trial subscription. Permissions are checked again
before model work and publication claim. At most two models run sequentially per
attempt, each with a 90-second timeout and at most 6,000 output tokens. Revocation
cannot recall a model request already sent; later stages recheck authorization.

Review shows the first 2,000 source characters, stored book/chapter names, editable
destination, formatted content, HTML and tags. BookStack errors leave the local
inbox available. Publication atomically claims the item and searches BookStack for
`[wissen-intake=<item UUID>] {type:page}` before creation; every new page carries
that tag. Retry after a lost acknowledgement reconciles the same page. Repeated
successful publication returns the stored URL; simultaneous claims return 409.
Retain the correlation tag for this guarantee. Startup/hourly recovery marks jobs
stalled over ten minutes as failed, including uncertain publication; a reviewed
failed draft may be retried using the same reconciliation. Source text is NULLed
immediately on publish/reject. Items older than 30 days are deleted hourly; backups
retain their independently configured retention period.

### Verification

`INTAKE_DB_TEST=1 npx vitest run tests/intake-db.integration.test.ts` (with the operator DB/TLS environment) proves concurrent quota reservation and stale-job recovery against real Postgres. It removes its test rows.

`npm test` includes all four extraction formats, invalid uploads, prompt structure,
HTML sanitization, authenticated encryption, state transitions, membership
isolation/roles, Chutes fallbacks and mocked BookStack fetch calls.
`python -m unittest discover -s ops/provisioner -p 'test_*.py'` checks token
idempotence/encryption as well as existing lifecycle tests.

For an operator-run end-to-end check, start a production build on **127.0.0.1:3993**
with `AUTH_URL=http://127.0.0.1:3993`, `AUTH_TRUST_HOST=true`, database TLS settings,
`DATABASE_URL=$DATABASE_URL_LOCAL`, the usual auth/Stripe environment, and the new
intake variables. Run `INTAKE_LIVE_CHECK=demo node scripts/intake-live-check.mjs`
with the same DB/auth/KMS environment. This deliberately creates SQL test identities
and short-lived signed test sessions without automating any login. It temporarily
assigns the unowned running demo tenant to the test team, uploads Markdown, calls
real Chutes, proves role/team denial, publishes and verifies the page via the
BookStack API. Its `finally` block restores `team_id=NULL` and removes all test
users, memberships, intake items and rate-limit records. It leaves one useful demo
page and writes a credential-free result under the operator work directory.
Never run it against an assigned/customer tenant. Stop the local test process
when finished. No Stripe purchase or email is made.

API reference: https://demo.bookstackapp.com/api/docs
### Tenant off-host backups

Storage Box rsync/SSH replication, 30-day remote retention and authenticated restore
checks are documented in [tenant operations](ops/provisioner/README.md#off-host-backups-hetzner-storage-box).
Setup is pending a Storage Box: the initial API order was rejected with HTTP 403.

Migration 006 checks for duplicate normalized emails before modifying anything and adds a unique `lower(email)` index. Resolve any duplicate accounts manually if the migration refuses to proceed. Host migration: source the external app env, export `DATABASE_URL="$DATABASE_URL_LOCAL"`, source the external database TLS env, then `npm run migrate`.

## First-party pilot analytics

Migration `012_analytics.sql` adds cookieless page views, funnel events and team attribution. Set **`ADMIN_EMAILS`** to a comma-separated allowlist of operator email addresses; `/admin/stats` returns 404 to everyone else, including when unset. `npm run stats` uses the same query with the standard DB/TLS environment. Both show the last 14 UTC dates including today; visits are distinct daily visitor hashes per source, summed over dates, not unique people over 14 days. Events are activity counts rather than cohort conversion rates. Workspace and intake status events are transactional database triggers; successful welcome consumption records trials once.

The browser stores sanitized UTM labels in sessionStorage, forwards source only to same-origin checkout fetches, and honors DNT/GPC. Checkout persists opt-out for team events. No analytics cookies, IPs, raw user agents, query strings or private paths are stored. Referrer is hostname only. Random process-local salts are destroyed at UTC midnight; restarts can increase deduplicated visit counts. Run one application process, as for the existing hourly cleanup. Cleanup deletes analytics rows older than 90 days at startup/hourly. Tracking is limited to 60 requests per daily visitor hash per minute and requires the existing trusted proxy IP configuration. Failed/dropped beacons silently return 204. Team attribution lasts with the team; analytics retention does not alter operational or consent records.
