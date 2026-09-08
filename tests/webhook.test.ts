import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  handleStripeEvent,
  syncCheckout,
  type Queryable,
} from "../lib/billing";
const sub = {
  id: "sub_1",
  customer: "cus_1",
  status: "trialing",
  trial_end: 1800000000,
  cancel_at_period_end: false,
  items: {
    data: [{ price: { id: "price_team" }, current_period_end: 1800000000 }],
  },
} as Stripe.Subscription;
function mockDb(duplicate = false) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("INSERT INTO stripe_events"))
      return {
        rows: duplicate ? [] : [{ id: "evt" }],
        rowCount: duplicate ? 0 : 1,
      };
    if (sql.startsWith("SELECT id FROM teams"))
      return { rows: [{ id: "team_1" }], rowCount: 1 };
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
      [
        "team_1",
        "sub_1",
        "trialing",
        "price_team",
        new Date(1800000000000),
        new Date(1800000000000),
        false,
      ],
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
});
