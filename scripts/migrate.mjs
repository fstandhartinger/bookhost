import pg from "pg";
import { databaseConfig } from "./db-config.mjs";
import { readdir, readFile } from "node:fs/promises";
const pool = new pg.Pool(databaseConfig());
pool.on("error", () =>
  console.error("Database migration pool connection failed"),
);
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(827492014)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (
    await readdir(new URL("../db/migrations/", import.meta.url))
  )
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rowCount
    )
      continue;
    await client.query(
      await readFile(
        new URL("../db/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
      name,
    ]);
    console.log("Applied migration:", name);
  }
  await client.query("COMMIT");
} catch {
  if (client) await client.query("ROLLBACK");
  console.error(
    "Database migration failed; check connectivity and schema permissions.",
  );
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
