# Home-page funnel measurement

This reuses the cookieless first-party mechanism added in migration 012 and
extended to `/agents` and `/bookstack-mcp` in e6fd6ac. No third-party scripts,
cookies, browser storage or cross-day identifiers are added.

Apply migration `041_checkout_click_positions.sql` through the normal release
process **before** serving the new application. This worker did not apply it to
any database or deploy the app.

## Read the counts

- `/admin/stats`: allowlisted, verified operator login; last 14 UTC dates,
  page totals, per-source and daily event totals. `path = /` in the top-page
  table is the landing view count.
- `GET /api/operator/visits?days=14`: existing authenticated operator API for
  views and top pages (see its existing authorization; it does not expose
  checkout events).
- `scripts/analytics-report.mjs` exports `analyticsReport(db)`, the query used
  by the admin page. With an approved read-only operator DB connection, its
  return value provides `pages`, `sources`, `days`, and `referrers`. The
  existing `npm run stats` command is a separate cohort report; it does not
  print these new position columns.

| Question | Existing data / new subtype |
| --- | --- |
| Landing views | `page_views.path = '/'`; views and distinct daily hashes |
| Hero trial clicks | `trial_click_hero` |
| Navigation trial clicks | `trial_click_nav` |
| Pricing trial clicks | `trial_click_pricing_teaser` (home and `/pricing`) |
| Footer trial clicks | `trial_click_footer` (the home-page closing CTA) |
| Demo clicks | Existing `demo_click`, including hero and footer links |
| Stripe sessions successfully opened | Existing `checkout_start` report metric |
| Trial completed | Existing `trial_started`, written on trusted welcome consumption |
| Workspace created | Existing transactional `workspace_created` trigger; this means tenant row creation, not confirmed provisioner readiness |

New trial-click observations are stored as `events.name = 'checkout_start'`,
`checkout_stage = 'click'` and one allowlisted `cta_position`. They represent
attempts to start a checkout, including links that first lead to pricing, and
are separate from a successfully created Stripe session. Existing server-side
session events retain `checkout_stage IS NULL`; the admin query explicitly
filters that stage to preserve its old `checkout_start` meaning and totals.
Any separate operator query counting `name='checkout_start'` must now also use
`checkout_stage IS NULL` when it means successful session creation. Click
subtypes reuse the already disclosed checkout-start category; no privacy or
legal text was edited. The release reviewer should review this classification.

For an exact landing-view total with the same bounded window:

```sql
SELECT count(*) AS views, count(DISTINCT visitor_hash) AS daily_uniques
FROM page_views
WHERE path = '/'
  AND ts >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days') AT TIME ZONE 'UTC';
```

The last query's distinct hashes cannot link people across dates (each UTC
date uses a new salt), so the `daily_uniques` total is a sum of daily unique
visitors, not unique people over fourteen days. Events are activity totals,
not person-level conversion cohorts. Position counts include all public pages
that expose that CTA; they are not restricted to visitors who first saw `/`.

## Filtering and safety

The client reuses the existing DNT/GPC checks. `/api/track` retains its
same-origin validation, automated/empty user-agent filter, payload limit,
public-path allowlist, fixed campaign labels, daily hash and rate limit. Only
four fixed position labels are accepted; invalid positions and attempts to
forge trusted trial/workspace events are ignored. The existing retention job
removes the rows after 90 days. Checkout metadata retains the existing opt-out
propagation; showcase-team filtering and transactional writers are unchanged.

Headless browser screenshots are excluded by the existing agent filter. The
live trial check additionally sent `DNT: 1`. Local interaction checks intercept
`/api/track` and `/api/checkout`; no live Stripe calls or database writes are
needed for them.
