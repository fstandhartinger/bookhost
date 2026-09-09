import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ auth: vi.fn() }));
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
vi.mock("@/lib/stripe", () => ({ stripeClient: vi.fn() }));

import { POST as checkout } from "@/app/api/checkout/route";
import { POST as portal } from "@/app/api/portal/route";

const request = () =>
  new Request("http://localhost/api/billing", {
    method: "POST",
    body: "{}",
  });

beforeEach(() => {
  state.auth.mockResolvedValue({
    user: { id: "member-1", email: "member@example.invalid" },
  });
});

it("returns 403 for a member on checkout and portal", async () => {
  expect((await checkout(request())).status).toBe(403);
  expect((await portal(request())).status).toBe(403);
});
