import pg from "pg";
import { databaseConfig } from "./db-config.mjs";
import { analyticsReport } from "./analytics-report.mjs";
const pool = new pg.Pool(databaseConfig());
try {
  const report = await analyticsReport(pool);
  console.log(
    "Wissen — last 14 UTC days (including today). Visits deduplicated per day/source.",
  );
  console.log("By utm_source");
  console.table(report.sources);
  console.log("Daily totals");
  console.table(report.days);
} catch {
  console.error("Stats failed; check database connectivity and migration 012.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
