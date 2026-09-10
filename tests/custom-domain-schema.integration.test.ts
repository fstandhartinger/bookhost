import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const migration = readFileSync("db/migrations/030_custom_domain.sql", "utf8");
describe.skipIf(process.env.INTAKE_DB_TEST !== "1")(
  "custom domain database invariants",
  () => {
    let admin: Pool, db: Pool, schema: string;
    const team = "00000000-0000-0000-0000-000000000001";
    beforeEach(async () => {
      admin = new Pool({ connectionString: process.env.DATABASE_URL });
      schema = `domain_${randomUUID().replaceAll("-", "")}`;
      await admin.query(`CREATE SCHEMA ${schema}`);
      const target = new URL(process.env.DATABASE_URL!);
      target.searchParams.set("options", `-c search_path=${schema},public`);
      db = new Pool({ connectionString: target.toString() });
      await db.query("CREATE TABLE teams(id uuid PRIMARY KEY)");
      await db.query("INSERT INTO teams VALUES($1)", [team]);
      await db.query(migration);
    });
    afterEach(async () => {
      await db?.end();
      if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin?.end();
    });
    const insert = (host: string, owner = team) =>
      db.query(
        "INSERT INTO tenant_domains(team_id,host,verification_token) VALUES($1,$2,'fixture')",
        [owner, host],
      );
    it("allows additive migration replay", async () => {
      await insert("one.example.org");
      await db.query(migration);
      expect(
        (await db.query("SELECT status FROM tenant_domains")).rows[0].status,
      ).toBe("pending_dns");
    });
    it("serializes competing requests for the third slot", async () => {
      await insert("one.example.org");
      await insert("two.example.org");
      const results = await Promise.allSettled([
        insert("three.example.org"),
        insert("four.example.org"),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (await db.query("SELECT count(*) FROM tenant_domains")).rows[0].count,
      ).toBe("3");
    });
    it("keeps global ownership during withdrawal", async () => {
      const other = "00000000-0000-0000-0000-000000000002";
      await db.query("INSERT INTO teams VALUES($1)", [other]);
      await insert("wiki.example.org");
      await db.query("UPDATE tenant_domains SET removal_requested_at=now()");
      await expect(insert("wiki.example.org", other)).rejects.toMatchObject({
        code: "23505",
      });
    });
  },
);
