#!/usr/bin/env node
// Operator-only marker toggle. No control-plane route or customer UI exposes it.
import pg from "pg";
import { databaseConfig } from "../../scripts/db-config.mjs";

const [slug, mode, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  !slug ||
  slug === "demo" ||
  !/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(slug) ||
  !["on", "off"].includes(mode)
) {
  console.error("Usage: node ops/showcase/mark-team.mjs <tenant-slug> <on|off>");
  process.exit(2);
}

const pool = new pg.Pool(databaseConfig());
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  const targets = await client.query(
    `SELECT t.id,t.is_showcase FROM teams t
     JOIN tenants n ON n.team_id=t.id WHERE n.slug=$1 FOR UPDATE OF t`,
    [slug],
  );
  if (targets.rowCount !== 1) throw new Error("Expected exactly one team target");
  const target = targets.rows[0];
  const enabled = mode === "on";
  console.log(
    `Exact team target: slug=${slug} id=${target.id} current=${target.is_showcase} requested=${enabled}`,
  );
  await client.query("UPDATE teams SET is_showcase=$2 WHERE id=$1", [
    target.id,
    enabled,
  ]);
  if (enabled)
    await client.query(
      `UPDATE notifications SET resolved_at=now()
       WHERE resolved_at IS NULL AND user_id=(SELECT owner_user_id FROM teams WHERE id=$1)`,
      [target.id],
    );
  await client.query("COMMIT");
  console.log(`Showcase marker ${enabled ? "enabled" : "disabled"} for ${slug}.`);
} catch {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  console.error("Could not update the operator-only showcase marker; no change committed.");
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
