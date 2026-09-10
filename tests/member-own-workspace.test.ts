import type Stripe from "stripe";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ownedTeam: null as { id: string; stripe_customer_id: string } | null,
  memberships: 1,
  runningSubscription: 0,
  create: vi
    .fn<
      (
        params: Stripe.Checkout.SessionCreateParams,
      ) => Promise<{ id: string; url: string }>
    >()
    .mockResolvedValue({
      id: "cs_member_trial",
      url: "https://checkout.stripe.com/member-trial",
    }),
}));

vi.mock("@/auth", () => ({
  auth: async () => ({
    user: { id: "member-1", email: "member@example.invalid" },
  }),
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
      if (sql.includes("FROM teams WHERE owner_user_id"))
        return { rows: state.ownedTeam ? [state.ownedTeam] : [] };
      if (sql.includes("FROM memberships"))
        return { rows: [], rowCount: state.memberships };
      if (sql.includes("FROM subscriptions"))
        return {
          rows: [],
          rowCount: sql.includes("status IN") ? state.runningSubscription : 0,
        };
      return { rows: [], rowCount: 0 };
    },
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripeClient: () => ({ checkout: { sessions: { create: state.create } } }),
}));

import { POST } from "@/app/api/checkout/route";

const request = (body = "{}") =>
  new Request("http://localhost/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

beforeEach(() => {
  state.create.mockClear();
  state.ownedTeam = null;
  state.memberships = 1;
  state.runningSubscription = 0;
  process.env.STRIPE_PRICE_TEAM = "price_fixture";
});

it("lets a member of a foreign team start a trial for a new team of their own", async () => {
  const response = await POST(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    url: "https://checkout.stripe.com/member-trial",
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  const params = state.create.mock.calls[0][0];
  expect(params).toMatchObject({
    customer_email: "member@example.invalid",
    subscription_data: { trial_period_days: 14 },
  });
  expect(params.subscription_data?.metadata).not.toHaveProperty("team_id");
});

it("keeps rejecting an explicit reference to a foreign team with 403", async () => {
  const response = await POST(
    request(JSON.stringify({ team: "team-foreign" })),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: "Only the team owner can manage billing.",
  });
  expect(state.create).not.toHaveBeenCalled();
});

it("keeps routing an owner with a running subscription to the portal", async () => {
  state.ownedTeam = { id: "team-own", stripe_customer_id: "cus_own" };
  state.runningSubscription = 1;

  const response = await POST(request());

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ portal: true });
  expect(state.create).not.toHaveBeenCalled();
});
