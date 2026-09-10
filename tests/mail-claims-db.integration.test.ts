import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { databaseConfig } from "../scripts/db-config.mjs";
import { deliverNotifications } from "../lib/notifications";
import type { Queryable } from "../lib/billing";

describe.skipIf(process.env.NOTIFICATIONS_DB_TEST !== "1")(
  "durable mail claims on isolated Postgres",
  () => {
    let pool: Pool;
    let admin: Pool;
    const schema = `mail_claim_${crypto.randomUUID().replaceAll("-", "")}`;
    beforeAll(async () => {
      admin = new Pool(databaseConfig());
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({
        ...databaseConfig(),
        options: `-c search_path=${schema},public`,
      });
      await pool.query(
        "CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text)",
      );
      await pool.query(
        await readFile("db/migrations/013_notifications.sql", "utf8"),
      );
      await pool.query(
        "ALTER TABLE notifications ADD COLUMN resolved_at timestamptz, ADD COLUMN mail_status text NOT NULL DEFAULT 'pending', ADD COLUMN attempts integer NOT NULL DEFAULT 0",
      );
      await pool.query(
        await readFile("db/migrations/025_activation_notices.sql", "utf8"),
      );
      const migration = await readFile(
        "db/migrations/027_notice_mail_claims.sql",
        "utf8",
      );
      await pool.query(migration);
      await pool.query(migration);
      await pool.query(
        "INSERT INTO users(email) VALUES('fixture@example.invalid')",
      );
    });
    beforeEach(async () => {
      await pool.query("DELETE FROM notifications");
    });
    afterAll(async () => {
      await pool?.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    const insert = (count = 1, kind = "payment_failed") =>
      pool.query(
        `INSERT INTO notifications(user_id,kind,period,payload)
     SELECT u.id,$2,i::text,'{"text":"fixture","href":"/app/billing"}'::jsonb
     FROM users u,generate_series(1,$1::int) i`,
        [count, kind],
      );
    it("leaves both activation kinds visible and their delivery state untouched", async () => {
      await insert(1, "activation_workspace");
      await insert(1, "activation_first_page");
      const send = vi.fn();
      await deliverNotifications(pool, send);
      expect(send).not.toHaveBeenCalled();
      expect(
        (
          await pool.query(
            "SELECT mail_status,attempts,mail_claimed_at,resolved_at FROM notifications",
          )
        ).rows,
      ).toEqual([
        {
          mail_status: "pending",
          attempts: 0,
          mail_claimed_at: null,
          resolved_at: null,
        },
        {
          mail_status: "pending",
          attempts: 0,
          mail_claimed_at: null,
          resolved_at: null,
        },
      ]);
    });
    it("cannot deliver rolled-back creation and does not resend after SMTP succeeds but status persistence fails", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          "INSERT INTO notifications(user_id,kind,period,payload) SELECT id,'payment_failed','rollback','{}' FROM users",
        );
        await c.query("ROLLBACK");
      } finally {
        c.release();
      }
      const send = vi.fn(async () => {
        const row = (
          await pool.query(
            "SELECT mail_status,mail_claimed_at,attempts FROM notifications",
          )
        ).rows[0];
        expect(row).toMatchObject({ mail_status: "claimed", attempts: 1 });
        expect(row.mail_claimed_at).toBeInstanceOf(Date);
      });
      await deliverNotifications(pool, send);
      expect(send).not.toHaveBeenCalled();
      await insert();
      const failing = {
        query: async (sql: string, values: unknown[]) => {
          if (sql.startsWith("UPDATE notifications SET mail_status"))
            throw new Error("lost status connection");
          return pool.query(sql, values);
        },
      } as Queryable;
      await expect(deliverNotifications(failing, send)).rejects.toThrow(
        "lost status connection",
      );
      await deliverNotifications(pool, send);
      expect(send).toHaveBeenCalledTimes(1);
    });
    it("never reclaims after death between committed claim and transport", async () => {
      await insert();
      const send = vi.fn();
      const crash = {
        query: async (sql: string, values: unknown[]) => {
          await pool.query(sql, values);
          throw new Error("process died after claim commit");
        },
      } as Queryable;
      await expect(deliverNotifications(crash, send)).rejects.toThrow(
        "process died",
      );
      await deliverNotifications(pool, send);
      expect(send).not.toHaveBeenCalled();
    });
    it("does not retry ambiguous SMTP failure or legacy failed attempts", async () => {
      await insert(2);
      await pool.query(
        "UPDATE notifications SET mail_status='mail_failed',attempts=1 WHERE period='2'",
      );
      const send = vi.fn(async () => {
        throw new Error("SMTP acceptance unknown");
      });
      await deliverNotifications(pool, send);
      await deliverNotifications(pool, send);
      expect(send).toHaveBeenCalledTimes(1);
      expect(
        (await pool.query("SELECT attempts FROM notifications")).rows,
      ).toEqual([{ attempts: 1 }, { attempts: 1 }]);
    });
    it("two concurrent dispatchers claim disjoint rows without the billing lock", async () => {
      await insert(12);
      const c = await pool.connect();
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(827492015)");
      try {
        const send = vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 5));
        });
        await Promise.all([
          deliverNotifications(pool, send),
          deliverNotifications(pool, send),
        ]);
        expect(send).toHaveBeenCalledTimes(12);
        expect(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM notifications WHERE mail_status='sent' AND attempts=1",
            )
          ).rows[0].n,
        ).toBe(12);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("caps one run at 300 attempts with three concurrent sends", async () => {
      await insert(305);
      let active = 0,
        peak = 0;
      const send = vi.fn(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
      });
      expect(await deliverNotifications(pool, send)).toBe(300);
      expect(send).toHaveBeenCalledTimes(300);
      expect(peak).toBe(3);
      expect(await deliverNotifications(pool, send)).toBe(5);
      expect(send).toHaveBeenCalledTimes(305);
    });
  },
);
