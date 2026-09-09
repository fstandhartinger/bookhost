import { loadEnvFile } from "node:process";
// Operator files are optional; exported deployment variables always take precedence.
for (const file of ["../work/.app.env", "../work/.database-tls.env"]) {
  try {
    loadEnvFile(new URL(file, new URL("../", import.meta.url)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
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
} catch (error) {
  const reason = String(error.message || error)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[database URL]")
    .replace(/[\r\n]+/g, " ");
  const safe = [process.env.DATABASE_URL, process.env.DATABASE_SSL_CA_BASE64]
    .filter(Boolean)
    .reduce((text, secret) => text.split(secret).join("[redacted]"), reason);
  console.error(`Stats failed [${error.code || "connection/query"}]: ${safe}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
