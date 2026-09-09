import { loadEnvFile } from "node:process";
for (const file of ["../work/.app.env", "../work/.database-tls.env"]) {
  try { loadEnvFile(new URL(file, new URL("../", import.meta.url))); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
import pg from "pg";
import { databaseConfig } from "./db-config.mjs";
import { classifyTeam, classifyVisit, summarizeTeams } from "./cohorts.mjs";

const pool = new pg.Pool(databaseConfig());
const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((value) => value.trim()).filter(Boolean);
try {
  const windowStart = `(date_trunc('day',now() AT TIME ZONE 'UTC')-interval '13 days') AT TIME ZONE 'UTC'`;
  const views = await pool.query(`
    SELECT utm_source,utm_medium,referrer_host,visitor_hash,(ts AT TIME ZONE 'UTC')::date::text AS utc_day
    FROM page_views WHERE ts >= ${windowStart}`);
  const visitCounts = new Map();
  for (const view of views.rows) {
    const label = classifyVisit(view);
    const keys = visitCounts.get(label) || new Set();
    keys.add(`${view.visitor_hash}\0${view.utc_day}`);
    visitCounts.set(label, keys);
  }
  console.log("Visits (last 14 UTC days, unique visitor_hash + UTC day)");
  console.table([...visitCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, keys]) => ({ label, visits: keys.size })));

  const teams = await pool.query(`
    SELECT t.id,t.name,t.utm_source,u.email AS "ownerEmail",t.created_at AS "createdAt",
      (SELECT min(i.created_at) FROM intake_items i WHERE i.team_id=t.id AND i.status IN ('approved','published')) AS "firstPublishedIntakeAt",
      (SELECT min(e.ts) FROM events e WHERE e.team_id=t.id
        AND e.name IN ('intake_draft','intake_published','bookstack_opened')
        AND (e.ts AT TIME ZONE 'UTC')::date > (t.created_at AT TIME ZONE 'UTC')::date) AS "laterDayUsageAt"
    FROM teams t JOIN users u ON u.id=t.owner_user_id
    WHERE t.created_at >= ${windowStart}`);
  const teamRows = teams.rows.map((row) => ({ ...row, ownerEmail: row.ownerEmail, teamName: row.name }));
  const classifications = teamRows.map((row) => ({ ...row, ...classifyTeam(row, { adminEmails }) }));
  const teamSummary = summarizeTeams(teamRows, { adminEmails });
  console.log("Teams (external / internal / unclear, with reasons)");
  console.table(teamSummary.map(({ cohort, teams, reasons }) => ({ cohort, teams, reasons: JSON.stringify(reasons) })));
  console.log(`external teams: ${classifications.filter((row) => row.cohort === "external").length}`);

  console.log("Funnel by cohort");
  console.table(teamSummary.map(({ reasons, ...row }) => ({ ...row, reasons: JSON.stringify(reasons) })));
} catch (error) {
  const reason = String(error.message || error).replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL]").replace(/[\r\n]+/g, " ");
  const safe = [process.env.DATABASE_URL, process.env.DATABASE_SSL_CA_BASE64].filter(Boolean).reduce((value, secret) => value.split(secret).join("[redacted]"), reason);
  console.error(`Stats failed [${error.code || "connection/query"}]: ${safe}`);
  process.exitCode = 1;
} finally { await pool.end(); }
