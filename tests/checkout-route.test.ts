import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  status: "active",
  previous: false,
  customer: "cus_existing",
  create: vi
    .fn<
      (
        params: Stripe.Checkout.SessionCreateParams,
      ) => Promise<{ id: string; url: string }>
    >()
    .mockResolvedValue({
      id: "cs_fixture",
      url: "https://checkout.stripe.com/fixture",
    }),
}));
vi.mock("@/auth", () => ({
  auth: async () => ({ user: { id: "owner", email: "owner@example.invalid" } }),
}));
vi.mock("@/lib/security", () => ({
  clientIp: () => "192.0.2.1",
  sameOrigin: () => true,
  rateLimit: async () => true,
  digest: () => "hash",
}));
vi.mock("@/lib/db", () => ({
  transaction: async (fn: (c: unknown) => unknown) =>
    fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
  db: {
    query: async (sql: string) => {
      if (sql.includes("FROM tenants WHERE team_id"))
        return { rows: [{ status: "suspended", error: null }], rowCount: 1 };
      if (sql.includes("FROM teams"))
        return { rows: [{ id: "team", stripe_customer_id: state.customer }] };
      return {
        rows: [],
        rowCount:
          sql.includes("FROM subscriptions") &&
          (sql.includes("status IN") ? state.status : state.previous)
            ? 1
            : 0,
      };
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  stripeClient: () => ({ checkout: { sessions: { create: state.create } } }),
}));
import { POST } from "@/app/api/checkout/route";
const request = () =>
  new Request("http://localhost/api/checkout", { method: "POST", body: "{}" });
beforeEach(() => {
  state.create.mockClear();
  state.customer = "cus_existing";
  process.env.STRIPE_PRICE_TEAM = "price_fixture";
});
it.each(["trialing", "active", "past_due"])(
  "routes %s subscribers to their portal",
  async (status) => {
    state.status = status;
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ portal: true });
    expect(state.create).not.toHaveBeenCalled();
  },
);
it("uses the signed-in customer's identity for an empty CTA body", async () => {
  state.status = "";
  expect((await POST(request())).status).toBe(200);
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({ customer: "cus_existing" }),
    expect.any(Object),
  );
  state.customer = "";
  expect((await POST(request())).status).toBe(200);
  expect(state.create).toHaveBeenLastCalledWith(
    expect.objectContaining({ customer_email: "owner@example.invalid" }),
    expect.any(Object),
  );
});
it("forwards sanitized attribution and privacy choice into Stripe metadata", async () => {
  state.status = "";
  await POST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { "x-wissen-utm-source": "Reddit" },
      body: "{}",
    }),
  );
  expect(state.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      metadata: expect.objectContaining({ utm_source: "reddit" }),
    }),
    expect.any(Object),
  );
  await POST(
    new Request("http://localhost/api/checkout", {
      method: "POST",
      headers: { dnt: "1", "x-wissen-utm-source": "reddit" },
      body: "{}",
    }),
  );
  const params = state.create.mock.calls.at(-1)?.[0];
  expect(params).toMatchObject({ metadata: { no_analytics: "1" } });
  expect(params).not.toHaveProperty("metadata.utm_source");
});

it("resumes with the same customer and no second trial", async () => {
  state.status = "";
  state.previous = true;
  expect((await POST(request())).status).toBe(200);
  const params = state.create.mock.calls.at(-1)![0];
  expect(params.customer).toBe("cus_existing");
  expect(params.subscription_data).not.toHaveProperty("trial_period_days");
  expect(params.subscription_data).not.toHaveProperty("trial_settings");
  state.previous = false;
});

it("persists a team reservation and sends a durable Stripe idempotency key", async () => {
  state.status = "";
  await POST(request());
  expect(state.create).toHaveBeenLastCalledWith(expect.any(Object), {
    idempotencyKey: expect.stringContaining("bookhost:team:"),
  });
});
