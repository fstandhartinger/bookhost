import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  handleStripeEvent,
  syncSubscription,
  cancelDuplicateCheckout,
  syncCheckout,
  type Queryable,
} from "../lib/billing";
const sub = {
  id: "sub_1",
  created: 1790000000,
  customer: "cus_1",
  status: "trialing",
  trial_end: 1800000000,
  cancel_at_period_end: false,
  items: {
    data: [{ price: { id: "price_team" }, current_period_end: 1800000000 }],
  },
} as Stripe.Subscription;
function mockDb(
  duplicate = false,
  status = "trialing",
  customerSubs: string[] = [],
) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("INSERT INTO stripe_events"))
      return {
        rows: duplicate ? [] : [{ id: "evt" }],
        rowCount: duplicate ? 0 : 1,
      };
    if (sql.startsWith("SELECT id FROM teams"))
      return { rows: [{ id: "team_1" }], rowCount: 1 };
    if (sql.startsWith("SELECT s.stripe_subscription_id FROM subscriptions s"))
      return {
        rows: customerSubs.map((id) => ({ stripe_subscription_id: id })),
        rowCount: customerSubs.length,
      };
    if (sql.startsWith("SELECT * FROM effective_subscriptions"))
      return {
        rows: [{ ...sub, status, trial_end: new Date(sub.trial_end! * 1000) }],
        rowCount: 1,
      };
    return { rows: [], rowCount: 1 };
  });
  return { query, client: { query } as unknown as Queryable };
}
const stripe = {
  subscriptions: { retrieve: vi.fn(async () => sub) },
} as unknown as Pick<Stripe, "subscriptions">;
describe("webhook processing", () => {
  it("upserts subscription status and trial timestamps", async () => {
    const { query, client } = mockDb();
    await handleStripeEvent(
      client,
      {
        id: "evt_1",
        type: "customer.subscription.updated",
        data: { object: sub },
      } as Stripe.Event,
      stripe,
    );
    const call = query.mock.calls.find((c) =>
      c[0].startsWith("INSERT INTO subscriptions"),
    );
    expect(call).toBeTruthy();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT(stripe_subscription_id)"),
      expect.arrayContaining([
        "team_1",
        "sub_1",
        "trialing",
        "price_team",
        new Date(1800000000000),
        new Date(1800000000000),
        false,
        new Date(1790000000000),
        false,
      ]),
    );
  });
  it("ignores a duplicate event", async () => {
    const { query, client } = mockDb(true);
    await handleStripeEvent(
      client,
      {
        id: "evt_1",
        type: "customer.subscription.updated",
        data: { object: sub },
      } as Stripe.Event,
      stripe,
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("stores cancellation without retrieving a deleted subscription", async () => {
    const { query, client } = mockDb();
    await handleStripeEvent(
      client,
      {
        id: "evt_2",
        type: "customer.subscription.deleted",
        data: { object: { ...sub, status: "canceled" } },
      } as Stripe.Event,
      stripe,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO subscriptions"),
      expect.arrayContaining(["canceled"]),
    );
  });
  it("refreshes current subscription on failed invoices", async () => {
    const { query, client } = mockDb();
    await handleStripeEvent(
      client,
      {
        id: "evt_3",
        type: "invoice.payment_failed",
        data: {
          object: {
            parent: { subscription_details: { subscription: "sub_1" } },
          },
        },
      } as Stripe.Event,
      stripe,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO subscriptions"),
      expect.any(Array),
    );
  });
  it("does not claim an existing account by unverified Checkout email", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const result = await syncCheckout(
      { query } as unknown as Queryable,
      {
        id: "cs_new",
        status: "complete",
        metadata: { venture: "wissen" },
        customer: "cus_other",
        customer_email: "existing@example.com",
      } as unknown as Stripe.Checkout.Session,
    );
    expect(result).toBeNull();
    expect(query.mock.calls.length).toBe(3);
  });
  it("customer.updated re-syncs the subscription with the customer expanded", async () => {
    const { client } = mockDb(false, "trialing", ["sub_a", "sub_b"]);
    const retrieve = vi.fn(async () => sub);
    const api = {
      subscriptions: { retrieve },
    } as unknown as Pick<Stripe, "subscriptions">;
    await handleStripeEvent(
      client,
      {
        id: "evt_customer_updated",
        type: "customer.updated",
        data: { object: { id: "cus_1" } },
      } as Stripe.Event,
      api,
    );
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenCalledWith("sub_a", { expand: ["customer"] });
    expect(retrieve).toHaveBeenCalledWith("sub_b", { expand: ["customer"] });
  });
  it("a card added at customer level flips has_payment_method", async () => {
    const { query, client } = mockDb(false, "trialing", ["sub_1"]);
    const retrieve = vi.fn(
      async () =>
        ({
          ...sub,
          customer: {
            id: "cus_1",
            invoice_settings: { default_payment_method: "pm_test" },
          },
        }) as unknown as Stripe.Subscription,
    );
    const api = {
      subscriptions: { retrieve },
    } as unknown as Pick<Stripe, "subscriptions">;
    await handleStripeEvent(
      client,
      {
        id: "evt_card_added",
        type: "customer.updated",
        data: { object: { id: "cus_1" } },
      } as Stripe.Event,
      api,
    );
    const upsert = query.mock.calls.find(([sql]) =>
      String(sql).startsWith("INSERT INTO subscriptions"),
    );
    expect(upsert?.[0]).toContain("ON CONFLICT(stripe_subscription_id)");
    expect((upsert as unknown as [string, unknown[]])?.[1][8]).toBe(true);
  });
});

it.each([
  "canceled",
  "unpaid",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
])("reconciles tenant desired state for %s", async (status) => {
  const { query, client } = mockDb(false, status);
  await syncSubscription(client, { ...sub, status } as Stripe.Subscription);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE tenants"),
    [
      "team_1",
      ["active", "trialing", "past_due", "unpaid"].includes(status)
        ? "running"
        : "suspended",
    ],
  );
});
it("keeps a delinquent workspace running during the announced seven-day grace period", async () => {
  const { query, client } = mockDb(false, "past_due");
  await syncSubscription(client, {
    ...sub,
    status: "past_due",
  } as Stripe.Subscription);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE tenants"),
    ["team_1", "running"],
  );
  expect(
    query.mock.calls.some(
      ([sql]) =>
        String(sql).startsWith("INSERT INTO subscriptions") &&
        String(sql).includes("payment_grace_started_at"),
    ),
  ).toBe(true);
});
it("persists Stripe's actual contract end and clears retention on paid resume", async () => {
  const endedAt = 1_800_000_123;
  const { query, client } = mockDb(false, "canceled");
  await syncSubscription(client, {
    ...sub,
    status: "canceled",
    ended_at: endedAt,
  } as Stripe.Subscription);
  const upsert = query.mock.calls.find(([sql]) =>
    String(sql).startsWith("INSERT INTO subscriptions"),
  );
  expect(upsert?.[0]).toContain("contract_ended_at");
  expect((upsert as unknown as [string, unknown[]])?.[1]).toContainEqual(
    new Date(endedAt * 1000),
  );

  query.mockClear();
  await syncSubscription(client, { ...sub, status: "active" } as Stripe.Subscription);
  expect(
    query.mock.calls.some(([sql]) => {
      const statement = String(sql);
      return (
        statement.startsWith("INSERT INTO subscriptions") &&
        statement.includes("EXCLUDED.status='active'") &&
        statement.includes("ELSE NULL END,payment_grace_until")
      );
    }),
  ).toBe(true);
});
it("cancels a duplicate anonymous subscription without attaching a second team", async () => {
  const query = vi.fn(async () => ({
    rows: [{ stripe_subscription_id: "sub_original" }],
  }));
  const cancel = vi.fn();
  const api = {
    subscriptions: { retrieve: async () => sub, cancel },
  } as unknown as Pick<Stripe, "subscriptions">;
  expect(
    await cancelDuplicateCheckout(
      { query } as unknown as Queryable,
      {
        customer_email: "owner@example.invalid",
        subscription: "sub_duplicate",
      } as Stripe.Checkout.Session,
      api,
    ),
  ).toBe(true);
  expect(cancel).toHaveBeenCalledWith("sub_duplicate", {
    invoice_now: false,
    prorate: false,
  });
  expect(query).toHaveBeenCalledTimes(1);
});
