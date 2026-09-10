import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, transaction } from "@/lib/db";
import { quota } from "@/lib/intake/quota";
// Explicit isolated fixture opt-in. No upstream APIs, mail or provisioning.
describe.skipIf(process.env.QUOTA_DB_TEST !== "1")("quota SQL contract", () => {
  let user: string, team: string, tenant: string;
  beforeAll(async () => {
    user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `quota-${crypto.randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    team = (
      await db.query(
        "INSERT INTO teams(name,owner_user_id) VALUES('quota test',$1) RETURNING id",
        [user],
      )
    ).rows[0].id;
    tenant = (
      await db.query(
        "INSERT INTO tenants(team_id,slug,host) VALUES($1,$2,'example.invalid') RETURNING id",
        [team, `q-${crypto.randomUUID()}`],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    if (team) await db.query("DELETE FROM teams WHERE id=$1", [team]);
    if (user) await db.query("DELETE FROM users WHERE id=$1", [user]);
    await db.end();
  });
  async function item(period: string, html: string | null = null) {
    await db.query(
      "INSERT INTO intake_quota(team_id,period,draft_limit,used) VALUES($1,$2,300,1) ON CONFLICT(team_id,period) DO UPDATE SET used=1",
      [team, period],
    );
    return (
      await db.query(
        "INSERT INTO intake_items(team_id,tenant_id,filename,mime,target_book_id,status,quota_period,draft_html) VALUES($1,$2,'a.txt','text/plain',1,'drafting',$3,$4) RETURNING id",
        [team, tenant, period, html],
      )
    ).rows[0].id;
  }
  async function used(period: string) {
    return (
      await db.query(
        "SELECT used FROM intake_quota WHERE team_id=$1 AND period=$2",
        [team, period],
      )
    ).rows[0].used;
  }
  it("only one concurrent reservation takes the final trial place", async () => {
    await quota(team, "trialing");
    await db.query(
      "UPDATE intake_quota SET used=19 WHERE team_id=$1 AND period='trial'",
      [team],
    );
    const attempts = await Promise.allSettled([
      quota(team, "trialing", true),
      quota(team, "trialing", true),
      quota(team, "trialing", true),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await used("trial")).toBe(20);
  });
  it("refunds failed drafting once into the old period, not the current month", async () => {
    const id = await item("2026-08");
    await db.query("UPDATE intake_items SET status='failed' WHERE id=$1", [id]);
    await db.query("UPDATE intake_items SET status='failed' WHERE id=$1", [id]);
    expect(await used("2026-08")).toBe(0);
    expect(
      (
        await db.query("SELECT quota_period FROM intake_items WHERE id=$1", [
          id,
        ])
      ).rows[0].quota_period,
    ).toBeNull();
  });
  it("hourly recovery refunds queued and drafting interruptions", async () => {
    const id = await item("2026-07");
    await db.query(
      "UPDATE intake_items SET status='queued',updated_at=now()-interval '2 hours' WHERE id=$1",
      [id],
    );
    const { recoverIntake } = await import("@/lib/intake/jobs");
    await recoverIntake();
    expect(await used("2026-07")).toBe(0);
  });
  it("keeps a produced draft charged after publication failure", async () => {
    const id = await item("2026-06", "<p>Generated draft</p>");
    await db.query("UPDATE intake_items SET status='failed' WHERE id=$1", [id]);
    expect(await used("2026-06")).toBe(1);
  });
  it("does not guess a period for legacy rows", async () => {
    const id = await item("2026-05");
    await db.query("UPDATE intake_items SET quota_period=NULL WHERE id=$1", [
      id,
    ]);
    await db.query("UPDATE intake_items SET status='failed' WHERE id=$1", [id]);
    expect(await used("2026-05")).toBe(1);
  });
  it("rolls reservation back if item insertion cannot commit", async () => {
    await db.query(
      "UPDATE intake_quota SET used=0 WHERE team_id=$1 AND period='trial'",
      [team],
    );
    await expect(
      transaction(async (c) => {
        await quota(team, "trialing", true, c);
        await c.query("INSERT INTO intake_items(team_id) VALUES($1)", [team]);
      }),
    ).rejects.toThrow();
    expect(await used("trial")).toBe(0);
  });
});
