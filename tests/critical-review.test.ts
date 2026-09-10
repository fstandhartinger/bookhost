import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const m = vi.hoisted(() => ({ query: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: m.query },
  transaction: (fn: (c: unknown) => unknown) => fn({ query: m.query }),
}));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<object>()),
  clientFor: async () => ({ request: m.request }),
}));
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
import { manageTeam } from "@/lib/team";
import {
  cancelDuplicateCheckout,
  handleStripeEvent,
  type Queryable,
} from "@/lib/billing";
const team = "11111111-1111-4111-8111-111111111111";
const owner = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333";
beforeEach(() => {
  m.query.mockReset();
  m.request.mockReset();
  m.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("FROM teams"))
      return { rows: [{ id: team, owner_user_id: owner }] };
    if (sql.includes("SELECT role FROM memberships"))
      return { rows: [{ role: args[1] === owner ? "owner" : "member" }] };
    if (sql.includes("FROM member_bookstack_revocations"))
      return { rows: [{ bookstack_user_id: 43, managed_by_bookhost: true }] };
    if (sql.includes("FROM tenants"))
      return {
        rows: [{ id: team, slug: "fixture", email: "owner@example.invalid" }],
      };
    return { rows: [], rowCount: 1 };
  });
  m.request.mockImplementation(async (path: string) =>
    path.startsWith("users?")
      ? { data: [{ id: 1, email: "owner@example.invalid" }] }
      : { id: 43 },
  );
});
it("removal deletes managed remote account with ownership migration before losing its mapping", async () => {
  await manageTeam(owner, { teamId: team, userId: user, action: "remove" });
  expect(m.request).toHaveBeenCalledWith(
    "users/43",
    { migrate_ownership_id: 1 },
    "DELETE",
  );
  expect(m.query).toHaveBeenCalledWith(
    expect.stringContaining("revoked_at=now()"),
    [team, user],
  );
});
it("failed remote removal still removes membership and persists a retryable error", async () => {
  m.request.mockRejectedValue(new Error("upstream secret"));
  await expect(
    manageTeam(owner, { teamId: team, userId: user, action: "remove" }),
  ).resolves.toMatchObject({ ok: true });
  expect(m.query).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM memberships"),
    [team, user],
  );
  expect(m.query).toHaveBeenCalledWith(
    expect.stringContaining("revocation_error=$3"),
    [team, user, expect.not.stringContaining("secret")],
  );
});
it("duplicate check uses customer even with absent checkout email", async () => {
  const query = vi.fn(async (sql: string, args: unknown[]) => ({
    rows:
      sql.includes("stripe_customer_id=$1") && args[0] === "cus_bound"
        ? [{ stripe_subscription_id: "sub_old" }]
        : [],
  }));
  const cancel = vi.fn();
  const stripe = {
    subscriptions: { retrieve: async () => ({ status: "active" }), cancel },
  } as unknown as Pick<Stripe, "subscriptions">;
  expect(
    await cancelDuplicateCheckout(
      { query } as unknown as Queryable,
      {
        customer: "cus_bound",
        subscription: "sub_new",
      } as Stripe.Checkout.Session,
      stripe,
    ),
  ).toBe(true);
  expect(cancel).toHaveBeenCalled();
});
it("subscription-created webhook cancels second subscription before upsert", async () => {
  const query = vi.fn(async (sql: string) => ({
    rowCount: 1,
    rows: sql.includes("stripe_subscription_id FROM")
      ? [{ stripe_subscription_id: "sub_old" }]
      : sql.includes("FROM teams")
        ? [{ id: team }]
        : [],
  }));
  const sub = {
    id: "sub_new",
    customer: "cus_bound",
    status: "active",
    items: { data: [] },
    created: 1,
  } as unknown as Stripe.Subscription;
  const cancel = vi.fn();
  await handleStripeEvent(
    { query } as unknown as Queryable,
    {
      id: "evt_new",
      type: "customer.subscription.created",
      data: { object: sub },
    } as Stripe.Event,
    { subscriptions: { retrieve: async () => sub, cancel } } as unknown as Pick<
      Stripe,
      "subscriptions"
    >,
  );
  expect(cancel).toHaveBeenCalledWith("sub_new", {
    invoice_now: false,
    prorate: false,
  });
  expect(
    query.mock.calls.some(([sql]) =>
      sql.startsWith("INSERT INTO subscriptions"),
    ),
  ).toBe(false);
});

it("does not delete a pre-existing or unverified account", async () => {
  const implementation = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql: string, args: unknown[] = []) =>
    sql.includes("FROM member_bookstack_revocations")
      ? { rows: [{ bookstack_user_id: 43, managed_by_bookhost: null }] }
      : implementation(sql, args),
  );
  await manageTeam(owner, { teamId: team, userId: user, action: "remove" });
  expect(m.request).not.toHaveBeenCalled();
  expect(m.query).toHaveBeenCalledWith(
    expect.stringContaining("revocation_error=$3"),
    [team, user, expect.stringContaining("unverified")],
  );
});
it("retry is authorized independently of the removed membership", async () => {
  const implementation = m.query.getMockImplementation()!;
  m.query.mockImplementation(async (sql: string, args: unknown[] = []) =>
    sql.includes("SELECT role FROM memberships") && args[1] === user
      ? { rows: [] }
      : implementation(sql, args),
  );
  await manageTeam(owner, {
    teamId: team,
    userId: user,
    action: "retry-revocation",
  });
  expect(m.request).toHaveBeenCalledWith(
    "users/43",
    { migrate_ownership_id: 1 },
    "DELETE",
  );
});

it.each([204, 404])(
  "remote deletion accepts %s without parsing an empty/error body",
  async (status) => {
    const { BookStack } = await import("@/lib/intake/bookstack");
    const fetch = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        new BookStack(
          "fixture.example.invalid",
          "fixture-id",
          "fixture-secret",
        ).request("users/43", { migrate_ownership_id: 1 }, "DELETE"),
      ).resolves.toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        "https://fixture.example.invalid/api/users/43",
        expect.objectContaining({
          method: "DELETE",
          body: '{"migrate_ownership_id":1}',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
