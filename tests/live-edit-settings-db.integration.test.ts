import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/intake/crypto";
import { IntakeError } from "@/lib/intake/access";
import {
  liveEditReady,
  liveEditSettings,
  setLiveEditEnabled,
} from "@/lib/live-edit/settings";

// Reuses INTAKE_DB_TEST like agent-access-db.integration.test.ts (see
// ops/testdb.sh) — no dedicated flag needed, this is the same disposable
// Postgres and the same cluster of DB-backed feature tests.
const RUN = process.env.INTAKE_DB_TEST === "1";

const ids: { users: string[]; teams: string[]; tenants: string[] } = {
  users: [],
  teams: [],
  tenants: [],
};

async function makeTenant(label: string, role: "owner" | "admin" | "member" = "owner") {
  const owner = (
    await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      `live-edit-${label}-owner-${crypto.randomUUID()}@example.invalid`,
    ])
  ).rows[0].id;
  ids.users.push(owner);
  const team = (
    await db.query(
      "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
      [`Live Edit ${label}`, owner],
    )
  ).rows[0].id;
  ids.teams.push(team);
  await db.query(
    "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,'owner')",
    [owner, team],
  );
  await db.query(
    "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '7 days')",
    [team, `sub_live_edit_${crypto.randomUUID()}`],
  );
  const slug = `liveedit${label}${crypto.randomUUID().slice(0, 8)}`;
  const tenant = (
    await db.query(
      "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$3,'running','running') RETURNING id",
      [team, slug, `${slug}.bookhost.co`],
    )
  ).rows[0].id;
  ids.tenants.push(tenant);
  let actor = owner;
  if (role !== "owner") {
    actor = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `live-edit-${label}-${role}-${crypto.randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    ids.users.push(actor);
    await db.query(
      "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,$3)",
      [actor, team, role],
    );
  }
  return { owner, actor, team, tenant, slug };
}

describe.skipIf(!RUN)("Live Edit settings against Postgres", () => {
  beforeAll(() => {
    vi.stubEnv("INTAKE_KMS_KEY", "cd".repeat(32));
  });
  afterAll(async () => {
    await db.query("DELETE FROM live_edit_sessions WHERE tenant_id=ANY($1)", [
      ids.tenants,
    ]);
    await db.query("DELETE FROM live_edit_settings WHERE tenant_id=ANY($1)", [
      ids.tenants,
    ]);
    await db.query("DELETE FROM tenants WHERE id=ANY($1)", [ids.tenants]);
    await db.query("DELETE FROM subscriptions WHERE team_id=ANY($1)", [
      ids.teams,
    ]);
    await db.query("DELETE FROM memberships WHERE team_id=ANY($1)", [
      ids.teams,
    ]);
    await db.query("DELETE FROM teams WHERE id=ANY($1)", [ids.teams]);
    await db.query("DELETE FROM users WHERE id=ANY($1)", [ids.users]);
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    await db.query("DELETE FROM live_edit_settings WHERE tenant_id=ANY($1)", [
      ids.tenants,
    ]);
  });

  it("defaults to off for a workspace that never touched the toggle", async () => {
    const t = await makeTenant("default");
    const settings = await liveEditSettings(t.tenant);
    expect(settings).toEqual({
      enabled: false,
      rollout_status: "none",
      rollout_error: null,
    });
    expect(await liveEditReady(t.tenant)).toBe(false);
  });

  it("an owner turning it on queues a rollout and stores a tenant-bound encrypted secret", async () => {
    const t = await makeTenant("owner-on");
    const result = await setLiveEditEnabled(t.owner, t.tenant, true);
    expect(result.rollout_status).toBe("pending");
    const row = (
      await db.query(
        "SELECT enabled,rollout_status,hmac_secret_enc FROM live_edit_settings WHERE tenant_id=$1",
        [t.tenant],
      )
    ).rows[0];
    expect(row.enabled).toBe(true);
    expect(row.rollout_status).toBe("pending");
    expect(row.hmac_secret_enc).toMatch(/^v1:/);
    // Bound to this tenant's slug via AAD — decrypting under the wrong slug
    // must fail, the same isolation property tenant_secrets already relies on.
    expect(() => decrypt(row.hmac_secret_enc, "someone-elses-slug")).toThrow();
    expect(decrypt(row.hmac_secret_enc, t.slug)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a member (not owner/admin) cannot flip the toggle", async () => {
    const t = await makeTenant("member-blocked", "member");
    await expect(setLiveEditEnabled(t.actor, t.tenant, true)).rejects.toMatchObject(
      { status: 403 },
    );
    const settings = await liveEditSettings(t.tenant);
    expect(settings.enabled).toBe(false);
  });

  it("an admin can turn it on and off", async () => {
    const t = await makeTenant("admin-toggle", "admin");
    await setLiveEditEnabled(t.actor, t.tenant, true);
    expect((await liveEditSettings(t.tenant)).enabled).toBe(true);
    await setLiveEditEnabled(t.actor, t.tenant, false);
    expect((await liveEditSettings(t.tenant)).enabled).toBe(false);
  });

  it("turning off keeps the rollout secret so re-enabling doesn't restart the tenant again", async () => {
    const t = await makeTenant("keep-secret");
    await setLiveEditEnabled(t.owner, t.tenant, true);
    await db.query(
      "UPDATE live_edit_settings SET rollout_status='ready' WHERE tenant_id=$1",
      [t.tenant],
    );
    const before = (
      await db.query(
        "SELECT hmac_secret_enc FROM live_edit_settings WHERE tenant_id=$1",
        [t.tenant],
      )
    ).rows[0].hmac_secret_enc;
    await setLiveEditEnabled(t.owner, t.tenant, false);
    const second = await setLiveEditEnabled(t.owner, t.tenant, true);
    expect(second.rollout_status).toBe("ready"); // no re-rollout needed
    const after = (
      await db.query(
        "SELECT hmac_secret_enc FROM live_edit_settings WHERE tenant_id=$1",
        [t.tenant],
      )
    ).rows[0].hmac_secret_enc;
    expect(after).toBe(before);
    expect(await liveEditReady(t.tenant)).toBe(true);
  });

  it("workspace isolation: acting on one tenant never changes another", async () => {
    const a = await makeTenant("iso-a");
    const b = await makeTenant("iso-b");
    await setLiveEditEnabled(a.owner, a.tenant, true);
    expect((await liveEditSettings(b.tenant)).enabled).toBe(false);
    // Owner of A cannot manage B's settings at all.
    await expect(
      setLiveEditEnabled(a.owner, b.tenant, true),
    ).rejects.toBeInstanceOf(IntakeError);
  });

  it("an unknown tenant id is refused, not silently created", async () => {
    const t = await makeTenant("unknown-tenant-actor");
    await expect(
      setLiveEditEnabled(t.owner, crypto.randomUUID(), true),
    ).rejects.toMatchObject({ status: 404 });
  });
});
