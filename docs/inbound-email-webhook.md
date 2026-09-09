# Wissen inbound email contract (Slice 2)

POST `https://wissen.app.mintapis.com/api/intake/inbound` with `Content-Type: application/json`.
The receiver must durably spool mail until Wissen returns 202. This endpoint is available independently of the UI rollout flag for adapter acceptance tests. It never publishes a page.

## Authentication

`X-Wissen-Signature: t=<unix-seconds>,v1=<lowercase-hex>`

Compute HMAC-SHA256 with the UTF-8 value of `INBOUND_WEBHOOK_SECRET` as key and the bytes of `t + "." + rawBody` as input. Sign the exact UTF-8 JSON bytes sent, without reserialization. Requests more than 300 seconds in the past or future fail. Send exactly one timestamp and signature. Refresh the timestamp/signature on retries, preserving `message_id` and payload. The operator generates a 32-byte random hex secret in the external, mode-0600 `work/.inbound.env`; never put it in this public repository. Install the same secret in Wissen and the trusted receiver over the existing private operator channel.

The shared secret authenticates the receiver, **not an email author**. Before signing, MailMint must validate the claimed From identity using its SMTP authentication/SPF/DKIM/DMARC policy and reject spoofed or unverifiable author identities. A forged From matching the allowlist must never reach this webhook as authenticated mail. Header `Authentication-Results` supplied by a sender is not trusted. Forwarding exceptions require an explicit receiver policy; HMAC alone is not that policy. No login automation or remote attachment URL fetching is involved.

## JSON

```json
{
  "message_id": "stable-receiver-delivery-id",
  "to": ["example@intake.wissen.app.mintapis.com"],
  "from": {"address": "author@example.org", "name": "Author"},
  "subject": "Our review checklist",
  "text": "Plain-text body",
  "html": "<p>Optional; ignored for document extraction</p>",
  "attachments": [{
    "filename": "checklist.md",
    "content_type": "text/markdown",
    "size": 19,
    "content_base64": "IyBSZXZpZXcgY2hlY2tsaXN0Cg=="
  }],
  "received_at": "2026-09-09T01:00:00Z"
}
```

`from.name` and `html` are optional; all other fields are required. `message_id` is a nonempty string, at most 998 characters. Use a durable, receiver-generated ID, rather than trusting sender-supplied Message-ID uniqueness. It is globally unique within this integration. For mail to multiple Wissen workspaces send a separate request per recipient and derive a distinct stable message_id for each. Exactly one recipient per request prevents accidental cross-team disclosure. Addresses/domains are case normalized; only the exact intake domain and slug are routed.

Limits: **15 MiB for the entire raw JSON request, including base64 overhead**, and 15 MiB decoded text/HTML/attachments combined; at most 5 attachments, each at most 10 MiB (the existing upload limit). Base64 must be canonical padded RFC 4648 encoding and decoded size must equal `size`. Filename length at most 255, no paths/control characters. Supported extensions/MIME pairs:

| Extension | content_type |
| --- | --- |
| .pdf | application/pdf |
| .docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document |
| .md | text/markdown or text/plain |
| .txt | text/plain |

Extraction uses the existing isolated subprocess and file format checks. Unsupported/encrypted/corrupt documents can be accepted and subsequently show `failed` for review; 202 acknowledges durable admission, not a successful draft. No executable or HTML attachment is accepted. Inline MIME images must be excluded by the receiver rather than relabeled as documents. With zero attachments the trimmed plain text must exceed 200 characters and becomes `email.md`; HTML is never converted or fetched. With attachments the body is not a separate document.

## Results and retries

| Status | Meaning |
| --- | --- |
| 202 | `{ "item_ids": ["uuid"] }`; committed, one item per attachment or plain-text fallback |
| 401 | Missing/invalid signature, timestamp outside tolerance, or secret unconfigured |
| 404 | Unknown recipient/workspace, workspace not running, or inactive/expired subscription |
| 403 | Sender not a member and not explicitly allowed |
| 413 | Request/file/aggregate/count limit |
| 429 | Shared upload/email team hourly limit or insufficient draft allowance; Retry-After: 30 |
| 400 | Malformed JSON, fields, attachment type/encoding or too-short body |
| 409 | message_id already belongs to another workspace |
| 502/503 | Temporary destination, database or configuration failure |

Retry network failures, 429 and 5xx with backoff (30s, 2m, 10m, 1h, 6h); retain spool and surface exhausted retries to operators. Quota exhaustion may require waiting for the next quota period or owner action, so respect an overall retry budget. Other 4xx are permanent delivery failures. Never return successful SMTP delivery without durable spooling or a successful application acknowledgement.

Accepted message IDs are retained until team deletion, independently of 30-day item retention. Repeating an accepted ID for the same authorized sender/workspace returns the original item IDs without new items, quota, or model calls; original IDs may refer to items already removed by retention. Payload changes under an existing ID do not update the document. Revoked senders and suspended workspaces remain rejected even on replay.

## Storage, dispatch and authorization

Migration `015_inbound_email.sql` is idempotent. `intake_senders` holds exact addresses or exact domain patterns (`@company.com`, excluding subdomains); current team membership always grants send permission. Owner/admin-only same-origin authenticated mutations are at `/api/intake/senders?tenant=<uuid>`. The intake dashboard displays member addresses, custom rules, the workspace address with a copy button, and rejected-mail count (existing events retention: 90 days). Rejections store only `events.name='inbound_rejected'` and team ID, no content or sender. This operational count is recorded independently of analytics opt-out; the existing schema calls event kind `name`.

Admission locks the workspace row, reserves the full document count atomically in the existing trial/monthly quota, and commits message, items and attachment bytes together. Destination is the last used book if still available, otherwise `Team handbook` (created when missing). The subject seeds and remains the proposed title; sender/name/subject/received time are in `source_metadata`. Items use `source='email'`, `status='queued'` and an owner/admin as the internal pipeline actor. That does not authorize auto-publication: the existing human approval rules still apply.

A five-second dispatcher uses the existing two-slot upload/extraction/Chutes pool and queue/draft implementation. Committed queued files survive restart in `intake_email_files`; bytes are removed on completion/failure. As with existing uploads, interrupted drafting is marked failed by the existing recovery sweep (startup/hourly, ten-minute staleness), not silently re-run. Queued emails are excluded from stale-upload failure cleanup. Items expire after 30 days. Run one application process, matching the existing in-process admission pool and cleanup architecture. DB backups contain submitted documents and need the same access and retention protection.

## Rollout and verification

New variables:

- `INBOUND_WEBHOOK_SECRET`: required secret for accepting signed requests.
- `INBOUND_EMAIL_ENABLED=true`: show delivery as enabled in the dashboard. Any other value shows “E-mail intake is being enabled for your workspace” and explicitly labels the address as a preview. This flag does not bypass HMAC or sender checks and is not a webhook kill switch; remove the secret to disable admission.

Keep the UI flag false until MailMint domain/slug routing, authenticated author policy, durable spool/retries and MX are verified. This slice does not change SMTP, DNS or production environment. Load the external app/TLS env with exports, set `DATABASE_URL="$DATABASE_URL_LOCAL"`, then `npm run migrate`. Run `INTAKE_DB_TEST=1 npx vitest run tests/inbound-db.integration.test.ts` for real PostgreSQL transactions plus mocked BookStack and draft provider. Run `npm test`, `npm run lint`, `npm run build` for release checks.

For the authorized live demo acceptance: load `.app.env`, `.database-tls.env`, `.intake.env`, `.inbound.env`, set the local DB URL and start the production build on 127.0.0.1:3989 with AUTH_TRUST_HOST=true. `INBOUND_LIVE_CHECK=demo node scripts/inbound-live-check.mjs` assigns a synthetic trial team only to an unassigned demo tenant, uses curl with a privately written signature header file, checks 202/replay/401/403 and waits for a real Chutes draft. It deletes its items, events, membership, subscription, quota, message records, rate counter and user, restores the demo assignment, and writes a sanitized evidence JSON under work. No page is published and no actual email is sent.
