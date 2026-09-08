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
| `SMTP_FROM` | Sender identity for magic-link messages. |
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
- JWTs last seven days; magic links last 15 minutes. Without SMTP, production shows the setup message and a trial CTA. Development logs magic links explicitly; never forward development logs to a shared service.
- Google does not silently link an existing email account. Sign in with the original email method first. Production email needs configuring before launch for durable return access.
- Checkout session URLs and callback query strings are bearer-like sensitive data. Redact them in proxy/access logs; responses are not logged by this app.
- Checkout is limited to 15 attempts per caller per hour; magic-link email to 5 per recipient per hour. Configure trusted proxy IP headers. Clean expired `rate_limits`, `verification_tokens` and abandoned `checkout_attempts` periodically under the operator's retention policy.

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
- Configure SMTP or Google and exercise return login without disabling verification; this task sends no emails and automates no third-party logins.
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
run server-side. The HTML allowlist removes scripts, images, links and attributes
both before storage/publication and in the preview.

### New environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `INTAKE_KMS_KEY` | Yes, app and worker | 32 random bytes encoded as 64 hex characters; AES-256-GCM key. Keep stable and back it up separately from the database. |
| `CHUTES_API_KEY` | Yes, app | Chutes server-side inference credential. Never expose as a public variable. |
| `INTAKE_MODELS` | Optional, app | Comma-separated fast models (at most two). Default: `google/gemma-4-31B-turbo-TEE,deepseek-ai/DeepSeek-V3.2-TEE`. Verify availability against Chutes `/v1/models` before changing. |
| `BOOKSTACK_API_ID` / `BOOKSTACK_API_SECRET` | Generated tenant files only | Both values in `tenants/<slug>/.env` are encrypted `v1:` envelopes, not directly usable API credentials. |
| `INTAKE_LIVE_CHECK` | Test only | Set to `demo` to explicitly enable the operator acceptance script. Not needed at runtime. |

Apply migration `010_intake.sql` with `npm run migrate` **before deploying the new
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
once for existing tenants such as `demo`. It uses the tenant's existing admin,
ensures its admin role has `access-api`, and stores a bcrypt token hash in
BookStack. It never prints credentials. Repeating it reuses the same token;
credential values are persisted atomically before BookStack creation so a crash
can be resumed. `tenant_secrets` stores the API ID and encrypted secret; ciphertext
uses a random 12-byte nonce and tenant-slug AAD. Both app and worker use the same
`v1:` base64(nonce + ciphertext + 16-byte tag) format.

Do not simply replace the KMS key: existing credentials must first be decrypted
with the old key and re-encrypted with the new one in both stores. Keep the old key
until the new deployment and backups are verified. No key rotation UI is included.

### Review state and failures

`uploaded → drafting → draft → approved → published`; a draft can instead be
rejected. Extraction errors do not create an item. Generation failures become
`failed` with a safe error. The provider receives the document as untrusted source
material and must return JSON with a summary, 3–6 tags and reviewer checklist.
Generation tries a second model on invalid/unavailable output, but honors 429
without immediate retries. Each model has a 90-second timeout.

Publication first atomically claims `draft → approved`, saving the human edits,
then calls BookStack. Concurrent or repeated requests receive 409. There is no
automatic retry of a page creation: a network failure may occur after BookStack
has committed. Such failures become `failed` and instruct the reviewer to check
BookStack before resubmitting. A process crash can leave `drafting` or `approved`;
the UI explains recovery. Operators must reconcile `approved` against BookStack
before resetting anything. Durable background jobs/reconciliation are a later
slice. Records remain until team deletion or operator retention cleanup; establish
the customer retention policy before public launch.

### Verification

`npm test` includes all four extraction formats, invalid uploads, prompt structure,
HTML sanitization, authenticated encryption, state transitions, membership
isolation/roles, Chutes fallbacks and mocked BookStack fetch calls.
`python -m unittest discover -s ops/provisioner -p 'test_*.py'` checks token
idempotence/encryption as well as existing lifecycle tests.

For an operator-run end-to-end check, start a production build on **127.0.0.1:3995**
with `AUTH_URL=http://127.0.0.1:3995`, `AUTH_TRUST_HOST=true`, database TLS settings,
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
