// All dates are UTC calendar dates. The window is the last 14 UTC dates including today.
// “Day 2” is strictly after the UTC signup date, not an elapsed 24-hour window.
// Visits are unique (visitor_hash, UTC day) pairs. This module has no database access.
export const QA_SOURCES = new Set(["test", "orchestrator-smoke", "qa", "e2e", "smoke", "owner", "internal", "claude", "codex", "hermes"]);
export const QUALIFIED_USAGE_EVENTS = new Set(["intake_draft", "intake_published", "bookstack_opened"]);
export const DEFAULT_OWN_DOMAINS = ["productivity-boost.com", "ndhartinger.de", "mintapis.com", "bookhost.co"];
const VISIT_DOMAINS = ["bookhost.co", "wissen.app.mintapis.com", "bookhost.cloud", "bookhost.online", "bookhost.site"];
const text = (v) => typeof v === "string" ? v.trim() : "";
const lower = (v) => text(v).toLowerCase();
function inDomain(host, domains) { const h = lower(host).replace(/\.$/, ""); return h && domains.some((d) => { const root = lower(d).replace(/^\.+|\.+$/g, ""); return h === root || h.endsWith(`.${root}`); }); }
function isQa(v) { return QA_SOURCES.has(lower(v)); }
function utcDay(value) { const date = new Date(value); if (Number.isNaN(date.valueOf())) throw new TypeError(`Invalid cohort timestamp: ${value}`); return date.toISOString().slice(0, 10); }

export function classifyVisit({ utm_source, utm_medium, referrer_host } = {}) {
  if (isQa(utm_source) || ["qa", "test"].includes(lower(utm_medium)) || inDomain(referrer_host, VISIT_DOMAINS)) return "internal";
  const source = lower(utm_source); if (source) return `unclear (utm: ${source})`;
  const medium = lower(utm_medium); if (medium) return `unclear (medium: ${medium})`;
  const referrer = lower(referrer_host); if (referrer) return `unclear (referrer: ${referrer})`;
  return "unclear (no provenance)";
}

/** @param {object} input @param {{now?: Date, adminEmails?: string[], ownDomains?: string[]}} [options] */
export function classifyTeam({ ownerEmail, utm_source, utm_medium, teamName, createdAt, firstPublishedIntakeAt, laterDayUsageAt } = {}, { now = new Date(), adminEmails = /** @type {string[]} */ ([]), ownDomains = DEFAULT_OWN_DOMAINS } = {}) {
  void now;
  const email = lower(ownerEmail); const admins = new Set(adminEmails.map(lower));
  const emailDomain = email.includes("@") ? email.split("@").pop() : "";
  if (admins.has(email) || inDomain(emailDomain, ownDomains)) return { cohort: "internal", reason: "owner identity is internal" };
  if (isQa(utm_source) || ["qa", "test"].includes(lower(utm_medium))) return { cohort: "internal", reason: "QA UTM" };
  if (/(^|\W)(test|qa|smoke|e2e|demo)(\W|$)/i.test(text(teamName))) return { cohort: "internal", reason: "QA team name" };
  if (!email) return { cohort: "unclear", reason: "unknown identity" };
  if (!firstPublishedIntakeAt) return { cohort: "unclear", reason: "no published intake" };
  if (!laterDayUsageAt || utcDay(laterDayUsageAt) <= utcDay(createdAt)) return { cohort: "unclear", reason: "no later-day usage" };
  return { cohort: "external", reason: "published intake and later-day usage" };
}

export function summarizeTeams(rows, options = {}) {
  const buckets = new Map(["external", "internal", "unclear"].map((cohort) => [cohort, { cohort, teams: 0, teams_with_published_intake: 0, teams_with_later_day_usage: 0, reasons: {} }]));
  for (const row of rows) { const result = classifyTeam(row, options); const bucket = buckets.get(result.cohort); bucket.teams += 1; if (row.firstPublishedIntakeAt) bucket.teams_with_published_intake += 1; if (row.laterDayUsageAt) bucket.teams_with_later_day_usage += 1; bucket.reasons[result.reason] = (bucket.reasons[result.reason] || 0) + 1; }
  return [...buckets.values()];
}
export { utcDay };
