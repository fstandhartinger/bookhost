import { expect, it } from "vitest";
import { Pool } from "pg";
import { encode } from "next-auth/jwt";
import { readFile } from "node:fs/promises";
import { databaseConfig } from "../scripts/db-config.mjs";
import { generateNotifications, markNoticeRead } from "../lib/notifications";
it.skipIf(process.env.NOTIFICATIONS_DB_TEST !== "1")(
  "migration, real concurrent deduplication, owner-scoped reads and production trial UI",
  async () => {
    const db = new Pool(databaseConfig());
    let user: string | undefined;
    let team: string | undefined;
    try {
      const migration = await readFile(
        new URL("../db/migrations/013_notifications.sql", import.meta.url),
        "utf8",
      );
      await db.query(migration);
      await db.query(migration);
      user = (
        await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
          `trial-ux-${crypto.randomUUID()}@example.invalid`,
        ])
      ).rows[0].id;
      team = (
        await db.query(
          "INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES('Trial UX integration',$1,$2) RETURNING id",
          [user, `cus_fixture_${crypto.randomUUID()}`],
        )
      ).rows[0].id;
      await db.query(
        "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end,current_period_end) VALUES($1,$2,'trialing',now()+interval '2 days',now()+interval '2 days')",
        [team, `sub_fixture_${crypto.randomUUID()}`],
      );
      await generateNotifications(db);
      const notices = await db.query(
        "SELECT * FROM notifications WHERE user_id=$1",
        [user],
      );
      expect(notices.rows).toHaveLength(1);
      expect(notices.rows[0].kind).toBe("trial_ending_3d");
      await Promise.all([generateNotifications(db), generateNotifications(db)]);
      expect(
        (await db.query("SELECT * FROM notifications WHERE user_id=$1", [user]))
          .rows,
      ).toHaveLength(1);
      const cookie = "authjs.session-token";
      // A synthetic, short-lived session for this SQL fixture only; no login flow or external provider.
      const token = await encode({
        secret: process.env.AUTH_SECRET!,
        salt: cookie,
        token: {
          sub: user,
          session_version: 1,
          email: "fixture@example.invalid",
          auth_time: Math.floor(Date.now() / 1000),
        },
        maxAge: 120,
      });
      for (const path of ["/app", "/app/intake"]) {
        const response = await fetch(`http://127.0.0.1:3990${path}`, {
          headers: { cookie: `${cookie}=${token}` },
          redirect: "manual",
        });
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain("Your free trial ends in 2 days");
        expect(html).toContain("border-red-300 bg-red-50 text-red-900");
        expect(html).toContain("Add a payment method");
        if (path === "/app") {
          expect(html).toContain("Notices");
          expect(html).toContain("Mark as read");
        }
      }
      await markNoticeRead(db, crypto.randomUUID(), notices.rows[0].id);
      expect(
        (
          await db.query("SELECT read_at FROM notifications WHERE id=$1", [
            notices.rows[0].id,
          ])
        ).rows[0].read_at,
      ).toBeNull();
      await markNoticeRead(db, user!, notices.rows[0].id);
      expect(
        (
          await db.query("SELECT read_at FROM notifications WHERE id=$1", [
            notices.rows[0].id,
          ])
        ).rows[0].read_at,
      ).not.toBeNull();
    } finally {
      if (team) {
        await db.query("DELETE FROM subscriptions WHERE team_id=$1", [team]);
        await db.query("DELETE FROM teams WHERE id=$1", [team]);
      }
      if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
      await db.end();
    }
  },
  30000,
);
