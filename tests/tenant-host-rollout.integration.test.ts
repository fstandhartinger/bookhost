import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const enabled = process.env.INTAKE_DB_TEST === "1";
const migration = (name: string) =>
  readFileSync(`db/migrations/${name}`, "utf8");
describe.skipIf(!enabled)("tenant host expand/contract", () => {
  let admin: Pool;
  let db: Pool;
  let schema: string;
  let url: string;
  beforeEach(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    schema = `rollout_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const target = new URL(process.env.DATABASE_URL!);
    target.searchParams.set("options", `-c search_path=${schema},public`);
    url = target.toString();
    db = new Pool({ connectionString: url });
    await db.query(
      "CREATE TABLE schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())",
    );
    for (const name of readdirSync("db/migrations")
      .filter((n) => n.endsWith(".sql") && n < "021")
      .sort()) {
      await db.query(migration(name));
      await db.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    }
  });
  afterEach(async () => {
    await db?.end();
    if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
  });
  async function insert(slug: string, host?: string) {
    const user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `${slug}@example.invalid`,
      ])
    ).rows[0].id;
    const team = (
      await db.query(
        "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
        [slug, user],
      )
    ).rows[0].id;
    return host === undefined
      ? db.query(
          "INSERT INTO tenants(team_id,slug,status,admin_email) VALUES($1,$2,'pending','fixture@example.invalid') RETURNING *",
          [team, slug],
        )
      : db.query(
          "INSERT INTO tenants(team_id,slug,status,admin_email,host) VALUES($1,$2,'pending','fixture@example.invalid',$3) RETURNING *",
          [team, slug, host],
        );
  }
  it("backfills, accepts mixed writers and rollback traffic, fills NULL on UPDATE, preserves explicit hosts and uniqueness", async () => {
    await insert("existing");
    await db.query(migration("021_tenant_host.sql"));
    expect(
      (
        await db.query(
          "SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='tenants' AND column_name='host'",
          [schema],
        )
      ).rows[0].is_nullable,
    ).toBe("YES");
    expect(
      (await db.query("SELECT host FROM tenants WHERE slug='existing'")).rows[0]
        .host,
    ).toBe("existing.wissen.app.mintapis.com");
    expect((await insert("old-image")).rows[0].host).toBe(
      "old-image.wissen.app.mintapis.com",
    );
    expect((await insert("new-image", "custom.example.org")).rows[0].host).toBe(
      "custom.example.org",
    );
    expect((await insert("rollback")).rows[0].host).toBe(
      "rollback.wissen.app.mintapis.com",
    );
    expect(
      (
        await db.query(
          "UPDATE tenants SET host=NULL WHERE slug='old-image' RETURNING host",
        )
      ).rows[0].host,
    ).toBe("old-image.wissen.app.mintapis.com");
    await expect(
      insert("duplicate", "custom.example.org"),
    ).rejects.toMatchObject({ code: "23505" });
    await db.query(migration("021_tenant_host.sql"));
  });
  it("022 accepts inbound_rejected", async () => {
    await db.query(migration("022_event_names.sql"));
    await db.query("INSERT INTO events(name) VALUES('inbound_rejected')");
  });
  it("startup skips contract; explicit CLI applies it once and rejects legacy inserts afterwards", async () => {
    const run = (...args: string[]) =>
      execFileSync("npm", ["run", "migrate", "--", ...args], {
        env: {
          ...process.env,
          DATABASE_URL: url,
          DATABASE_SSL_CA_BASE64: "",
          DATABASE_SSL_SERVERNAME: "",
        },
        encoding: "utf8",
      });
    run();
    expect(
      (
        await db.query(
          "SELECT name FROM schema_migrations WHERE name LIKE '023%'",
        )
      ).rows,
    ).toEqual([]);
    expect((await insert("startup-old")).rows[0].host).toBe(
      "startup-old.wissen.app.mintapis.com",
    );
    run("--include-deferred");
    expect(
      (
        await db.query(
          "SELECT name FROM schema_migrations WHERE name LIKE '023%'",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(insert("contract-old")).rejects.toMatchObject({
      code: "23502",
    });
    expect(
      (await insert("contract-new", "contract.bookhost.co")).rows[0].host,
    ).toBe("contract.bookhost.co");
    expect(run("--include-deferred")).not.toContain("Applied migration");
    // Emergency precondition for an old-image rollback after contract.
    await db.query(
      "BEGIN; ALTER TABLE tenants ALTER COLUMN host DROP NOT NULL;" +
        migration("021_tenant_host.sql") +
        "; COMMIT;",
    );
    expect((await insert("restored-old")).rows[0].host).toBe(
      "restored-old.wissen.app.mintapis.com",
    );
  });
});
