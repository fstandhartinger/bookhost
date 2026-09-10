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
  failQuery: "",
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
      if (state.failQuery && sql.includes(state.failQuery))
        throw Object.assign(
          new Error("secret=sk_test_never_log token=private-upstream-body"),
          { code: "57014" },
        );
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
  state.failQuery = "";
  process.env.STRIPE_PRICE_TEAM = "price_fixture";
});

it("reports checkout-attempt persistence failures with a safe user-visible correlation", async () => {
  state.status = "";
  state.failQuery = "INSERT INTO checkout_attempts";
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await POST(request());
  const body = await response.json();

  expect(response.status).toBe(503);
  expect(body.reference).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(body.error).toContain(body.reference);
  expect(logged).toHaveBeenCalledTimes(1);
  const record = JSON.parse(String(logged.mock.calls[0][0]));
  expect(record).toMatchObject({
    event: "checkout_error",
    phase: "attempt_persist",
    team_id: "team",
    session_id: "cs_fixture",
    correlation_id: body.reference,
    error_category: "database_57014",
  });
  const serialized = JSON.stringify(logged.mock.calls);
  expect(serialized).not.toContain("sk_test_never_log");
  expect(serialized).not.toContain("private-upstream-body");
  logged.mockRestore();
});

it("reports analytics insertion failures without leaking them or failing checkout", async () => {
  state.status = "";
  state.failQuery = "INSERT INTO events";
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});

  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(logged).toHaveBeenCalledTimes(1);
  const record = JSON.parse(String(logged.mock.calls[0][0]));
  expect(record).toMatchObject({
    event: "checkout_error",
    phase: "analytics_insert",
    team_id: "team",
    session_id: "cs_fixture",
    correlation_id: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    ),
    error_category: "database_57014",
  });
  expect(JSON.stringify(logged.mock.calls)).not.toContain("sk_test_never_log");
  logged.mockRestore();
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
