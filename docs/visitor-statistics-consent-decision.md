# Consent decision — BookHost visitor statistics (Reichweitenmessung)

Status: **decided by implementer; independent code review round 1 done — task review-vs-bookhost-49, stage kimi (model-verified chutes/Kimi-K3-TEE), VERDICT PASS with 4 minor findings: findings 1 (rate-limit unit), 2 (hosting location) and 4 (this status line) are fixed in this record; finding 3 (pre-existing event-name over-claim in the privacy texts, predating this change) is tracked as follow-up `analytics-events-gap`.**
Not legal advice. This record binds the decision to the code that is actually shipped; it is
modelled on `/opt/model-market-comparison/ops/ux-2026-09-12/CR-67.5-CONSENT-DECISION.md`.

## 1. What is implemented (the facts the decision rests on)

Code: `lib/analytics/beacon.tsx` (client beacon and checkout decoration), `lib/analytics/attribution.ts`
(in-memory UTM attribution), `lib/analytics/shared.ts` (path/referrer/UTM sanitization, bot filter,
DNT/GPC), `lib/analytics/server.ts` (daily hash, admin gate), `app/api/track/route.ts` (ingest),
`app/admin/stats/page.tsx` + `scripts/analytics-report.mjs` (operator report),
`app/api/operator/visits/route.ts` (operator JSON), `lib/auth-cleanup.ts` (retention).
Tests: `tests/analytics.test.ts`, `tests/operator-visits.test.ts`, `tests/analytics-attribution.test.ts`.

| Question | Answer from the code |
|---|---|
| Storage on / active reading from the device for statistics | **None.** No cookie, `localStorage`, `sessionStorage`, pixel, or extra third-party request is used for statistics. The beacon (`lib/analytics/beacon.tsx`) sends one same-origin POST to `/api/track` per whitelisted public page view. The former `sessionStorage` campaign attribution was removed in this change; after the change a grep for `sessionStorage`, `localStorage` and `document.cookie` over `app/`, `lib/`, `components/` finds **zero** occurrences outside tests (`tests/analytics-attribution.test.ts` asserts the module never touches these globals). The only browser storage that remains anywhere is functional account state: the Auth.js session/CSRF cookies while signed in, which are disclosed as contract/communication processing, never read by the statistics code. |
| Data used per beacon (sent by the visitor's own page load, then discarded) | Whitelisted public page path without query string (`publicPath`, `lib/analytics/shared.ts` — private paths are dropped server-side), `document.referrer` reduced to the host (own hosts excluded, `referrerHost`), sanitized UTM labels only (`parseUtm`/`campaign`: no URLs, no e-mail addresses, bounded length), the User-Agent string (automated-traffic filter only, `automatedAgent`; never stored), DNT/`Sec-GPC` (objection). The raw IP address and User-Agent are **never written to the database**; they are combined in memory only (next row). |
| Identifiers | One daily hash only: `visitor_hash` = HMAC-SHA256(IP, truncated UA) with a random per-UTC-day salt that lives only in process memory and is zeroed/discarded at the day change or restart (`dailyHasher`, `lib/analytics/server.ts`). No cross-day linkage, no link to accounts (`users` is never joined with `page_views`/`events`), no visitor profiles, no fingerprinting. |
| What is stored | Rows in the existing first-party tables `page_views(path, referrer_host, utm_source, utm_medium, utm_campaign, visitor_hash)` and `events(name, utm_source, visitor_hash)` — aggregate inputs only. Rate-limited (60/minute per hash), payload capped at 2 KB (`app/api/track/route.ts`). |
| Retention | All `page_views` and `events` rows older than 90 days are deleted by the hourly cleanup run (`lib/auth-cleanup.ts`). |
| Where | The application's own Postgres database. **Deployment fact, proven by evidence at release, not by code**: the app DB runs on Sandy `65.109.49.103` (Hetzner Online GmbH, AS24940, Helsinki, Finland — EU). No analytics vendor, no third party receives analytics data, no reuse of the login identity for statistics, no visitor profiles. |
| Output | Operator-only: `/admin/stats` (`app/admin/stats/page.tsx`) and `GET /api/operator/visits?days=N` (`app/api/operator/visits/route.ts`, body `{days, topPages, topReferrers}`), both gated by auth → `isAdmin` (ADMIN_EMAILS) → verified operator e-mail, else 404. Aggregate counts only; the JSON answers with `Cache-Control: no-store`. |
| Objection | `Do Not Track` or `Global Privacy Control` suppresses the browser measurement and is forwarded for checkout-related team events (`x-wissen-no-analytics`, `lib/analytics/beacon.tsx`, `lib/analytics/shared.ts optedOut`, enforced in `app/api/track/route.ts`); an objection by e-mail (info@productivity-boost.com) is offered on `/privacy` and in the Datenschutz. |

## 2. Decision

**(a) No consent is required under § 25 TDDDG for this configuration, and no banner is added.**

- § 25(1) TDDDG covers *storing information on* or *accessing information stored in* the terminal
  equipment. The statistics feature stores nothing and runs nothing on the device: it sends one
  ordinary first-party request (`navigator.sendBeacon` to our own origin) and evaluates only the
  payload the page itself produces (path, referrer host, UTM labels). LfDI Baden-Württemberg
  (FAQ Cookies und Tracking, A.3.1) states that IP address and User-Agent sent automatically are
  not an "access" under § 25 and names local analysis without third parties, data-minimal
  configuration and no merging of usage data as the model for consent-free reach measurement —
  this implementation follows that model (first-party only, no third parties, no merging with
  accounts, 90-day retention).
- **The daily-hash unique count is kept**, because the hash lives only in server memory with a
  per-day random salt that is discarded and never persisted (`lib/analytics/server.ts`); it cannot
  recognize a visitor across days and is not merged with account data. This is a documented
  operator assessment ("in our assessment"), not legal advice: the EDPB Guidelines 2/2023 reading
  of "access"/fingerprinting is broad, and residual uncertainty is stated, not hidden. If a
  supervisory authority or court were to treat this hash as a fingerprint requiring consent, the
  fallback is to **switch the feature off or drop the hash** (report visits only), never to add a
  banner for these features.
- GDPR: the stored rows relate to no identifiable person (daily hash only, 90-day deletion). The
  transient processing rests on **Art. 6(1)(f) GDPR** — legitimate interest in improving and
  shaping our own offer; no profile, no third party, within the visitor's reasonable expectation
  of a first-party page request. **Art. 13** information is given on `/privacy` (English intro,
  "Visitor statistics (Reichweitenmessung)") and in the binding German Datenschutz
  (content/legal/datenschutz.md, "Reichweitenmessung"); **Art. 21** objection is honoured via
  DNT/GPC browser signals and by e-mail.
- **(b) Campaign attribution after this change is memory-only**: `lib/analytics/attribution.ts`
  keeps UTM labels in the open page's memory (survives SPA navigation, gone on full reload), so no
  information is stored on or read from the device and § 25 is not triggered. The previous
  `sessionStorage` persistence was removed in this change precisely because it would have been
  device storage for statistics without a written decision.

## 3. Conditions that would reopen this decision

Any of the following makes the statistics consent-relevant or requires a new record: client-side
storage for statistics (cookie, `localStorage`, `sessionStorage`, IndexedDB), any cookie for
statistics, an external analytics provider, fingerprinting or persistent IP-derived identifiers,
joining statistics with accounts or login identity, longer retention than 90 days, or an
IP-derived persistent identifier of any kind.

## 4. Technical proof (for the verifier)

1. `npm test` — `tests/analytics.test.ts` (daily-hash-only, sanitization, agent filter, admin
   gate, top-pages math), `tests/operator-visits.test.ts` (operator gate: anon/non-admin/unverified
   → 404, invalid days → 400, aggregate shape, `no-store`),
   `tests/analytics-attribution.test.ts` (attribution is memory-only; the module never touches
   `sessionStorage`/`localStorage`).
2. Grep proof: `grep -rn "sessionStorage\|localStorage\|document\.cookie" app lib components`
   returns nothing after this change (tests excluded); the Auth.js session cookie is functional
   account state, not statistics.
3. Supervisor live checks on the deployed revision: a page load with a real browser UA and a QA
   marker appears in `page_views`; the identical request with a curl UA produces no row; no
   request to any third-party analytics host (served HTML/bundle enumeration + network capture);
   unauthenticated `GET /api/operator/visits` → 404; QA marker rows deleted after the proof.

## Addendum 2026-09-26 — public paths after the revamp round

The `publicPath` allowlist in `lib/analytics/shared.ts` was extended so the first-party count also covers the
public pages added after the original decision: `/migrate`, `/reliability`, `/blog`, `/blog/<slug>` (bounded
slug pattern), the SEO guides `/bookstack-vs-confluence`, `/bookstack-backup-guide`,
`/self-hosted-vs-managed-bookstack`, `/eu-hosted-team-wiki`, plus `/privacy` and `/terms`. Every other fact in
this decision is unchanged: strict fixed-path allowlist without query strings, nothing stored on or read from
the device for statistics, no third party, daily-rotated in-memory hash salt, 90-day retention, operator-only
aggregate output. None of the §-3 reopening conditions is triggered.