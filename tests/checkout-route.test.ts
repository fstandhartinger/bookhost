import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  status: "active",
  customer: "cus_existing",
  create: vi.fn(async () => ({
    id: "cs_fixture",
    url: "https://checkout.stripe.com/fixture",
  })),
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
  db: {
    query: async (sql: string) => {
      if (sql.includes("FROM teams"))
        return { rows: [{ id: "team", stripe_customer_id: state.customer }] };
      return {
        rows: [],
        rowCount: sql.includes("FROM subscriptions") && state.status ? 1 : 0,
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
  );
  state.customer = "";
  expect((await POST(request())).status).toBe(200);
  expect(state.create).toHaveBeenLastCalledWith(
    expect.objectContaining({ customer_email: "owner@example.invalid" }),
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
