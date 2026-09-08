import { beforeEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
const state = vi.hoisted(() => ({
  consumed: false,
  bound: true,
  complete: true,
  existing: false,
  verified: false,
  duplicate: false,
  operations: [] as string[],
  consents: [] as unknown[][],
}));
vi.mock("@/auth", () => ({
  auth: async () => null,
  sessionCookie: () => ({
    name: "authjs.session-token",
    options: { httpOnly: true, sameSite: "lax", path: "/", secure: false },
  }),
}));
vi.mock("@/lib/stripe", () => ({
  stripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: async () => ({
          id: "cs_fixture",
          status: state.complete ? "complete" : "open",
          metadata: { venture: "wissen" },
          subscription: "sub_fixture",
        }),
      },
    },
    subscriptions: {
      retrieve: async () => {
        state.operations.push("stripe-retrieve");
        return { id: "sub_fixture" };
      },
    },
  }),
}));
vi.mock("@/lib/billing", () => ({
  cancelDuplicateCheckout: async () => state.duplicate,
  syncCheckout: async () => ({
    id: "team_fixture",
    owner_user_id: "user_fixture",
  }),
  syncSubscription: async () => {},
}));
vi.mock("@/lib/db", () => ({
  db: {},
  transaction: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, values: unknown[]) => {
        if (sql.includes("pg_advisory_xact_lock"))
          state.operations.push("lock");
        if (sql.includes("INSERT INTO consents")) state.consents.push(values);
        if (sql.includes("FROM checkout_attempts"))
          return {
            rows: state.bound
              ? [{ session_id: "cs_fixture", user_id: null }]
              : [],
          };
        if (sql.includes("SELECT 1 FROM checkout_logins"))
          return { rows: [], rowCount: state.consumed ? 1 : 0 };
        if (sql.includes("SELECT * FROM users"))
          return {
            rows: [
              {
                id: "user_fixture",
                session_version: 1,
                email_verified_at: state.verified ? new Date() : null,
                email: "fixture@example.invalid",
                name: "Fixture",
                checkout_session_id: state.existing ? "cs_other" : "cs_fixture",
              },
            ],
          };
        if (sql.includes("INSERT INTO checkout_logins")) state.consumed = true;
        return { rows: [], rowCount: 1 };
      },
    }),
}));
import { GET } from "@/app/welcome/route";
function request(cookie = true) {
  return new NextRequest(
    "http://127.0.0.1:3999/welcome?session_id=cs_fixture",
    { headers: cookie ? { cookie: "wissen-checkout=fixture-nonce" } : {} },
  );
}
beforeEach(() => {
  Object.assign(state, {
    consumed: false,
    bound: true,
    complete: true,
    existing: false,
    verified: false,
    duplicate: false,
    operations: [],
    consents: [],
  });
  process.env.AUTH_URL = "http://127.0.0.1:3999";
  process.env.AUTH_SECRET =
    "test-only-secret-not-a-production-credential-123456";
});
describe("Checkout-first login", () => {
  it("issues an Auth.js-compatible HttpOnly JWT once and rejects replay", async () => {
    const response = await GET(request());
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://127.0.0.1:3999/app?setup=password");
    const cookie = response.cookies.get("authjs.session-token");
    expect(cookie).toBeTruthy();
    const token = await decode({
      token: cookie!.value,
      secret: process.env.AUTH_SECRET!,
      salt: "authjs.session-token",
    });
    expect(token?.session_version).toBe(1);
    expect(token?.sub).toBe("user_fixture");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await GET(request())).headers.get("location")).toContain("/login");
  });
  it("rejects a different browser", async () => {
    state.bound = false;
    expect((await GET(request())).headers.get("location")).toContain("/login");
    expect(state.consumed).toBe(false);
  });
  it("rejects absent browser proof", async () => {
    expect((await GET(request(false))).headers.get("location")).toContain(
      "/login",
    );
    expect(state.consumed).toBe(false);
  });
  it("rejects incomplete checkouts", async () => {
    state.complete = false;
    expect((await GET(request())).headers.get("location")).toContain("/login");
    expect(state.consumed).toBe(false);
  });
  it("does not sign in to an existing account using an unverified checkout email", async () => {
    state.existing = true;
    expect((await GET(request())).headers.get("location")).toContain("/login");
    expect(state.consumed).toBe(false);
  });
});

it("does not reissue checkout access after the mailbox owner verified", async () => {
  state.verified = true;
  expect((await GET(request())).headers.get("location")).toContain("/login");
  expect(state.consumed).toBe(false);
});
it("redirects duplicate checkout to the existing workspace sign-in notice", async () => {
  state.duplicate = true;
  expect((await GET(request())).headers.get("location")).toContain(
    "checkout=existing",
  );
  expect(state.consumed).toBe(false);
});

it("refreshes Stripe under the webhook lock and records both contracts on success", async () => {
  await GET(request());
  expect(state.operations).toEqual(["lock", "stripe-retrieve"]);
  expect(state.consents.map((values) => values.slice(0, 4))).toEqual([
    ["user_fixture", "team_fixture", "agb", "2026-09-08"],
    ["user_fixture", "team_fixture", "avv", "2026-09-08"],
  ]);
  await GET(request());
  expect(state.consents).toHaveLength(2);
});
