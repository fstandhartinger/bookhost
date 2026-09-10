import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { databaseConfig } from "../scripts/db-config.mjs";
import { generateNotifications } from "../lib/notifications";

it.skipIf(process.env.ACTIVATION_DB_TEST !== "1")(
  "activation SQL, additive migration, exact thresholds, resolution and cancellation on isolated Postgres",
  async () => {
    const pool = new Pool(databaseConfig());
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Roll back all fixtures and migration checks; only use a disposable test DB.
      const migration = await readFile(
        new URL("../db/migrations/025_activation_notices.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);
      await client.query(migration);
      const user = (
        await client.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
          `${crypto.randomUUID()}@example.invalid`,
        ])
      ).rows[0].id;
      const start = new Date("2026-10-01T00:00:00Z");
      const at = (h: number) => new Date(+start + h * 3600_000);
      const team = (
        await client.query(
          "INSERT INTO teams(name,owner_user_id,created_at) VALUES('Activation fixture',$1,$2) RETURNING id",
          [user, start],
        )
      ).rows[0].id;
      const subscription = `sub_${crypto.randomUUID()}`;
      await client.query(
        "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',$3)",
        [team, subscription, at(336)],
      );
      const send = vi.fn(async () => undefined);
      expect(await generateNotifications(client, at(23))).toBe(0);
      expect(await generateNotifications(client, at(24))).toBe(1);
      expect(await generateNotifications(client, at(25))).toBe(0);
      expect(send).not.toHaveBeenCalled();
      await client.query(
        "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$3,'running','running')",
        [team, `fixture-${team}`, `${team}.example.invalid`],
      );
      await generateNotifications(client, at(26));
      expect(
        (
          await client.query(
            "SELECT resolved_at FROM notifications WHERE user_id=$1",
            [user],
          )
        ).rows[0].resolved_at,
      ).toEqual(at(26));
      expect(await generateNotifications(client, at(71))).toBe(0);
      expect(await generateNotifications(client, at(72))).toBe(1);
      expect(send).not.toHaveBeenCalled();
      await client.query(
        "INSERT INTO team_onboarding(team_id,step) VALUES($1,'publish')",
        [team],
      );
      await generateNotifications(client, at(73));
      expect(
        (
          await client.query(
            "SELECT * FROM notifications WHERE user_id=$1 AND resolved_at IS NULL",
            [user],
          )
        ).rows,
      ).toHaveLength(0);
      // A canceled trial must never retry an old activation notice.
      await client.query(
        "UPDATE notifications SET resolved_at=NULL,mail_status='mail_failed' WHERE user_id=$1",
        [user],
      );
      await client.query(
        "UPDATE subscriptions SET status='canceled' WHERE team_id=$1",
        [team],
      );
      await generateNotifications(client, at(74));
      expect(send).not.toHaveBeenCalled();
      expect(
        (
          await client.query(
            "SELECT * FROM notifications WHERE user_id=$1 AND resolved_at IS NULL",
            [user],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);
