import { expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "pg";
import type Stripe from "stripe";
import { readFile } from "node:fs/promises";
import { databaseConfig } from "../scripts/db-config.mjs";
import { generateNotifications, markNoticeRead } from "../lib/notifications";
import { syncSubscription } from "../lib/billing";
it.skipIf(process.env.NOTIFICATIONS_DB_TEST !== "1")(
  "014 twice, delayed predecessor, expiry, retry, resolution, locking and bounded mail concurrency on real Postgres",
  async () => {
    const pool = new Pool(databaseConfig());
    const schema = `trial_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const client = await pool.connect();
    const run = async (fn: (c: PoolClient) => Promise<unknown>) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`SET LOCAL search_path TO ${schema},public`);
        const result = await fn(c);
        await c.query("COMMIT");
        return result;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema},public`);
      for (const name of ["users", "teams", "subscriptions", "tenants"])
        await client.query(
          `CREATE TABLE ${name} (LIKE public.${name} INCLUDING ALL)`,
        );
      for (const file of [
        "013_notifications.sql",
        "014_billing_lifecycle.sql",
        "014_billing_lifecycle.sql",
      ])
        await client.query(
          await readFile(
            new URL(`../db/migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      const user = (
        await client.query(
          "INSERT INTO users(email) VALUES('fixture@example.invalid') RETURNING id",
        )
      ).rows[0].id;
      const team = (
        await client.query(
          "INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES('Fixture',$1,'cus_fixture') RETURNING id",
          [user],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO tenants(team_id,slug,status,desired_state) VALUES($1,'fixture','running','running')",
        [team],
      );
      const now = new Date();
      const end = Math.floor(now.getTime() / 1000) + 2 * 86400;
      const subscription = (id: string, status: string, created: number) =>
        ({
          id,
          customer: "cus_fixture",
          status,
          created,
          trial_end: end,
          cancel_at_period_end: false,
          items: {
            data: [{ price: { id: "price_fixture" }, current_period_end: end }],
          },
        }) as Stripe.Subscription;
      await run((c) =>
        syncSubscription(c, subscription("sub_old", "trialing", 100)),
      );
      const send = vi.fn(async (): Promise<void> => {
        throw new Error("fixture transport failure");
      });
      expect(await run((c) => generateNotifications(c, now, send))).toBe(1);
      expect(
        (await client.query("SELECT mail_status,attempts FROM notifications"))
          .rows[0],
      ).toMatchObject({ mail_status: "mail_failed", attempts: 1 });
      send.mockImplementation(async () => undefined);
      await run((c) => generateNotifications(c, now, send));
      expect(send).toHaveBeenCalledTimes(2);
      expect(
        (await client.query("SELECT mail_status,attempts FROM notifications"))
          .rows[0],
      ).toMatchObject({ mail_status: "sent", attempts: 2 });
      await run((c) => generateNotifications(c, now, send));
      expect(send).toHaveBeenCalledTimes(2);
      const notice = (await client.query("SELECT id FROM notifications"))
        .rows[0].id;
      await markNoticeRead(client, crypto.randomUUID(), notice);
      expect(
        (await client.query("SELECT read_at FROM notifications")).rows[0]
          .read_at,
      ).toBeNull();
      await markNoticeRead(client, user, notice);
      expect(
        (await client.query("SELECT read_at FROM notifications")).rows[0]
          .read_at,
      ).not.toBeNull();
      await run((c) =>
        syncSubscription(c, {
          ...subscription("sub_old", "trialing", 100),
          default_payment_method: "pm_fixture",
        }),
      );
      expect(
        (await client.query("SELECT resolved_at FROM notifications")).rows[0]
          .resolved_at,
      ).not.toBeNull();
      await run((c) =>
        syncSubscription(c, subscription("sub_new", "active", 200)),
      );
      await run((c) =>
        syncSubscription(c, subscription("sub_old", "canceled", 100)),
      );
      expect(
        (await client.query("SELECT desired_state FROM tenants")).rows[0]
          .desired_state,
      ).toBe("running");
      expect(
        (
          await client.query(
            "SELECT stripe_subscription_id FROM effective_subscriptions",
          )
        ).rows[0].stripe_subscription_id,
      ).toBe("sub_new");
      await run((c) =>
        syncSubscription(c, subscription("sub_old", "active", 100)),
      );
      expect(
        (
          await client.query(
            "SELECT stripe_subscription_id FROM effective_subscriptions",
          )
        ).rows[0].stripe_subscription_id,
      ).toBe("sub_new");
      // Expiry is reconciled without waiting for a webhook.
      await client.query(
        "UPDATE subscriptions SET status='canceled' WHERE stripe_subscription_id='sub_new'",
      );
      await client.query(
        "UPDATE subscriptions SET status='trialing',trial_end=$1 WHERE stripe_subscription_id='sub_old'",
        [now],
      );
      await run((c) => generateNotifications(c, now));
      expect(
        (await client.query("SELECT desired_state FROM tenants")).rows[0]
          .desired_state,
      ).toBe("suspended");
      await run((c) =>
        syncSubscription(c, subscription("sub_paid_resume", "active", 300)),
      );
      expect(
        (await client.query("SELECT desired_state FROM tenants")).rows[0]
          .desired_state,
      ).toBe("running");
      expect(
        (
          await client.query(
            "SELECT * FROM notifications WHERE resolved_at IS NULL",
          )
        ).rows,
      ).toHaveLength(0);
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(827492015)");
      expect(await run((c) => generateNotifications(c, now, send))).toBe(0);
      await client.query("COMMIT");
      // Several eligible owners exercise the outbox concurrency limit.
      for (let i = 0; i < 7; i++) {
        const u = (
          await client.query(
            "INSERT INTO users(email) VALUES($1) RETURNING id",
            [`fixture${i}@example.invalid`],
          )
        ).rows[0].id;
        const t = (
          await client.query(
            "INSERT INTO teams(name,owner_user_id) VALUES('Fixture',$1) RETURNING id",
            [u],
          )
        ).rows[0].id;
        await client.query(
          "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',$3)",
          [t, `sub_batch_${i}`, new Date(end * 1000)],
        );
      }
      let active = 0,
        peak = 0;
      const batchMail = vi.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
      });
      await Promise.all([
        run((c) => generateNotifications(c, now, batchMail)),
        run((c) => generateNotifications(c, now, batchMail)),
      ]);
      expect(batchMail).toHaveBeenCalledTimes(7);
      expect(peak).toBe(3);
    } finally {
      await client.query("ROLLBACK");
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  },
  30000,
);
