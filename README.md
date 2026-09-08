# Wissen control plane

Next.js 15 App Router, TypeScript, Tailwind, locally served Inter, Auth.js v5 (JWT), PostgreSQL and Stripe. Node 22; port 3000. The public website and team dashboard manage a hosted BookStack subscription and submit a tenant to an external provisioner. No BookStack provisioning or document/AI processing is performed here.

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
- Checkout JWTs last seven days; provider/password sessions last 30 days; magic links last 15 minutes. Password sign-in is always available. Set the first dashboard password after checkout at `/app?setup=password`; changes require the current password and revoke other sessions while renewing the current cookie. Password login neither verifies email nor revokes sessions. Argon2id hashes use 19 MiB memory, two iterations and one lane; passwords require 10–1024 characters.
- `/login/reset` sends single-use, SHA256-hashed reset tokens valid for 30 minutes when SMTP is configured. Reset revokes all sessions and requires a fresh login. Without SMTP the page directs users to support. Delivery errors are logged generically, and account existence is not disclosed. Development logs magic links explicitly; never forward development logs to a shared service.
- Google does not silently link an existing email account. Sign in with the original email method first. Production email needs configuring before launch for durable return access.
- Checkout session URLs and callback query strings are bearer-like sensitive data. Redact them in proxy/access logs; responses are not logged by this app.
- Checkout is limited to 15 attempts per caller per hour; magic-link email to 5 per recipient per hour. Password login is limited to 10 attempts per normalized email + IP per 15 minutes (HTTP 429 on attempt 11); password changes and reset requests are also throttled. Configure trusted proxy IP headers: the final `x-forwarded-for` entry must be set by the trusted proxy. Clean expired `password_reset_tokens`, `rate_limits`, `verification_tokens` and abandoned `checkout_attempts` periodically under the operator's retention policy.

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
- Keep document/email intake and AI features disabled until their independent implementation and permission checks are complete.

Legal Markdown comes from `content/legal`; raw HTML is not enabled. Relative legal-document links are normalized and GFM tables are supported.

### Tenant off-host backups

Storage Box rsync/SSH replication, 30-day remote retention and authenticated restore
checks are documented in [tenant operations](ops/provisioner/README.md#off-host-backups-hetzner-storage-box).
Setup is pending a Storage Box: the initial API order was rejected with HTTP 403.
