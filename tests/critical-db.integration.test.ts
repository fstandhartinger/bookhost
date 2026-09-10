import { afterAll, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { randomUUID } from "node:crypto";
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
const network = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<object>()),
  clientFor: async () => ({ request: network.request }),
}));
import { db } from "@/lib/db";
import { teamCheckout } from "@/lib/team-checkout";
import { manageTeam } from "@/lib/team";
const enabled = process.env.INTAKE_DB_TEST === "1";
afterAll(async () => {
  await db.end();
});
async function fixture() {
  const owner = (
    await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      `${randomUUID()}@example.invalid`,
    ])
  ).rows[0].id;
  const team = (
    await db.query(
      "INSERT INTO teams(name,owner_user_id,stripe_customer_id) VALUES('critical regression',$1,$2) RETURNING id",
      [owner, `cus_${randomUUID()}`],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, owner],
  );
  return { owner, team };
}
const params = {
  mode: "subscription",
  line_items: [{ price: "price_test", quantity: 1 }],
  success_url: "https://example.invalid/success",
  cancel_url: "https://example.invalid/cancel",
} as Stripe.Checkout.SessionCreateParams;
it.skipIf(!enabled)(
  "two concurrent checkouts share one committed reservation; ambiguous failure retries exact params/key",
  async () => {
    const { team } = await fixture();
    const calls: { key: string; params: unknown }[] = [];
    let failed = true;
    const session = {
      id: `cs_${randomUUID()}`,
      url: "https://checkout.stripe.com/fixture",
      status: "open",
    };
    const api = {
      checkout: {
        sessions: {
          create: async (p: unknown, o: { idempotencyKey: string }) => {
            const row = (
              await db.query(
                "SELECT * FROM team_checkout_reservations WHERE team_id=$1",
                [team],
              )
            ).rows[0];
            expect(row.idempotency_key).toBe(o.idempotencyKey); // visible from another connection: already committed
            calls.push({ key: o.idempotencyKey, params: p });
            if (failed) {
              failed = false;
              throw new Error("simulated response lost");
            }
            return session;
          },
          retrieve: async () => session,
        },
      },
    } as unknown as Pick<Stripe, "checkout">;
    const results = await Promise.allSettled([
      teamCheckout(team, params, api),
      teamCheckout(team, params, api),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(
      await teamCheckout(
        team,
        { ...params, cancel_url: "https://example.invalid/changed" },
        api,
      ),
    ).toMatchObject(session);
    expect(calls).toHaveLength(2);
    expect(
      (
        await db.query(
          "SELECT count(*) FROM team_checkout_reservations WHERE team_id=$1",
          [team],
        )
      ).rows[0].count,
    ).toBe("1");
  },
);
it.skipIf(!enabled)(
  "membership deletion preserves failed mapping, clears password, and successful retry migrates ownership",
  async () => {
    const { owner, team } = await fixture();
    const user = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `${randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    await db.query(
      "INSERT INTO memberships(team_id,user_id,role) VALUES($1,$2,'member')",
      [team, user],
    );
    await db.query(
      "INSERT INTO tenants(team_id,slug,admin_email) VALUES($1,$2,'owner@example.invalid')",
      [team, `crit-${randomUUID().slice(0, 8)}`],
    );
    await db.query(
      "INSERT INTO member_bookstack_logins(team_id,user_id,bookstack_user_id,managed_by_bookhost,initial_password) VALUES($1,$2,43,true,'fixture-only')",
      [team, user],
    );
    network.request.mockRejectedValue(new Error("upstream secret"));
    await manageTeam(owner, { teamId: team, userId: user, action: "remove" });
    expect(
      (
        await db.query(
          "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",
          [team, user],
        )
      ).rowCount,
    ).toBe(0);
    const row = (
      await db.query(
        "SELECT * FROM member_bookstack_revocations WHERE team_id=$1 AND user_id=$2",
        [team, user],
      )
    ).rows[0];
    expect(
      (
        await db.query(
          "SELECT 1 FROM member_bookstack_logins WHERE team_id=$1 AND user_id=$2",
          [team, user],
        )
      ).rowCount,
    ).toBe(0);
    expect(row).not.toHaveProperty("initial_password");
    expect(row.revocation_requested_at).toBeTruthy();
    expect(row.revocation_error).not.toContain("secret");
    const email = (
      await db.query("SELECT email FROM users WHERE id=$1", [owner])
    ).rows[0].email;
    network.request.mockImplementation(async (path: string) =>
      path.startsWith("users?") ? { data: [{ id: 1, email }] } : undefined,
    );
    await manageTeam(owner, {
      teamId: team,
      userId: user,
      action: "retry-revocation",
    });
    expect(network.request).toHaveBeenCalledWith(
      "users/43",
      { migrate_ownership_id: 1 },
      "DELETE",
    );
    const done = (
      await db.query(
        "SELECT revoked_at,revocation_error FROM member_bookstack_revocations WHERE team_id=$1 AND user_id=$2",
        [team, user],
      )
    ).rows[0];
    expect(done.revoked_at).toBeTruthy();
    expect(done.revocation_error).toBeNull();
  },
);

it.skipIf(!enabled)(
  "completed checkout blocks another purchase until billing arrives; expired sessions get a new durable key",
  async () => {
    const { team } = await fixture();
    let status = "open";
    const create = vi.fn(async () => ({
      id: `cs_${randomUUID()}`,
      url: "https://checkout.stripe.com/fixture",
      status: "open",
    }));
    const api = {
      checkout: { sessions: { create, retrieve: async () => ({ status }) } },
    } as unknown as Pick<Stripe, "checkout">;
    await teamCheckout(team, params, api);
    const first = (
      await db.query(
        "SELECT idempotency_key FROM team_checkout_reservations WHERE team_id=$1",
        [team],
      )
    ).rows[0].idempotency_key;
    status = "complete";
    await expect(teamCheckout(team, params, api)).rejects.toMatchObject({
      status: 409,
    });
    expect(create).toHaveBeenCalledTimes(1);
    status = "expired";
    await teamCheckout(team, params, api);
    const second = (
      await db.query(
        "SELECT idempotency_key FROM team_checkout_reservations WHERE team_id=$1",
        [team],
      )
    ).rows[0].idempotency_key;
    expect(second).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(2);
  },
);

it.skipIf(!enabled)(
  "bound customer identity wins over another owner email; unbound anonymous customer still deduplicates",
  async () => {
    const { cancelDuplicateCheckout } = await import("@/lib/billing");
    const first = await fixture(),
      second = await fixture();
    const subFirst = `sub_${randomUUID()}`,
      subSecond = `sub_${randomUUID()}`;
    await db.query(
      "INSERT INTO subscriptions(team_id,stripe_subscription_id,status) VALUES($1,$2,'active'),($3,$4,'active')",
      [first.team, subFirst, second.team, subSecond],
    );
    const customer = (
      await db.query("SELECT stripe_customer_id FROM teams WHERE id=$1", [
        first.team,
      ])
    ).rows[0].stripe_customer_id;
    const email = (
      await db.query("SELECT email FROM users WHERE id=$1", [second.owner])
    ).rows[0].email;
    const cancel = vi.fn(),
      log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stripe = {
      subscriptions: { retrieve: async () => ({ status: "active" }), cancel },
    } as unknown as Pick<Stripe, "subscriptions">;
    try {
      await cancelDuplicateCheckout(
        db,
        {
          customer,
          customer_email: email,
          subscription: "sub_duplicate",
        } as Stripe.Checkout.Session,
        stripe,
      );
      expect(log).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ retained_subscription: subFirst }),
      );
      await cancelDuplicateCheckout(
        db,
        {
          customer: `cus_${randomUUID()}`,
          customer_email: email,
          subscription: "sub_anonymous",
        } as Stripe.Checkout.Session,
        stripe,
      );
      expect(log).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({ retained_subscription: subSecond }),
      );
    } finally {
      log.mockRestore();
    }
  },
);
