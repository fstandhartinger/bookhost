import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: state.auth }));
vi.mock("@/lib/security", () => ({
  sameOrigin: () => true,
  clientIp: () => "192.0.2.1",
  digest: () => "fixture-hash",
  rateLimit: async () => true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: async (sql: string) => {
      if (sql.includes("FROM memberships")) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  },
}));
vi.mock("@/lib/stripe", () => ({
  stripeClient: () => ({
    checkout: { sessions: { create: state.create } },
  }),
}));

import { POST as checkout } from "@/app/api/checkout/route";
import { POST as portal } from "@/app/api/portal/route";

const request = (body = "{}") =>
  new Request("http://localhost/api/billing", {
    method: "POST",
    body,
  });

beforeEach(() => {
  state.auth.mockResolvedValue({
    user: { id: "member-1", email: "member@example.invalid" },
  });
  state.create.mockReset().mockResolvedValue({
    id: "cs_member",
    url: "https://checkout.stripe.com/member",
  });
  process.env.STRIPE_PRICE_TEAM = "price_fixture";
});

it("lets a member without their own team open checkout for a new team of their own", async () => {
  const response = await checkout(request());

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    url: "https://checkout.stripe.com/member",
  });
  expect(state.create).toHaveBeenCalledTimes(1);
});

it("keeps billing for a foreign team off-limits for members", async () => {
  const response = await checkout(
    request(JSON.stringify({ team: "team-foreign" })),
  );

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: "Only the team owner can manage billing.",
  });
  expect(state.create).not.toHaveBeenCalled();

  expect((await portal(request())).status).toBe(403);
});
