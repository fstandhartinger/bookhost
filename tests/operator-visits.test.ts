import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: mocks.query } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
import { GET } from "@/app/api/operator/visits/route";

const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.query.mockReset();
  mocks.auth.mockReset();
  vi.stubEnv("ADMIN_EMAILS", "owner@example.org");
  mocks.query.mockImplementation(async (sql: string) => {
    if (String(sql).startsWith("SELECT email,email_verified_at"))
      return {
        rows: [{ email: "owner@example.org", email_verified_at: new Date() }],
      };
    if (String(sql).includes("::date::text"))
      return { rows: [{ date: today, visits: 3, uniques: 2 }] };
    if (String(sql).includes("SELECT path,"))
      return { rows: [{ path: "/", visits: 3, uniques: 2 }] };
    if (String(sql).includes("SELECT referrer_host"))
      return { rows: [{ host: "example.org", visits: 2, uniques: 1 }] };
    throw new Error("unexpected query: " + sql);
  });
});

const request = (query = "") =>
  new Request("http://localhost/api/operator/visits" + query);

it("denies anonymous and non-admin callers with 404 before any query", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(404);
  mocks.auth.mockResolvedValue({
    user: { id: "u1", email: "other@example.org" },
  });
  expect((await GET(request())).status).toBe(404);
  expect(mocks.query).not.toHaveBeenCalled();
});

it("denies a listed admin with unverified e-mail", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "u1", email: "owner@example.org" },
  });
  mocks.query.mockImplementation(async (sql: string) => {
    if (String(sql).startsWith("SELECT email,email_verified_at"))
      return { rows: [{ email: "owner@example.org", email_verified_at: null }] };
    throw new Error("unexpected query: " + sql);
  });
  expect((await GET(request())).status).toBe(404);
});

it("serves the zero-filled aggregate with no-store for a verified admin", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "u1", email: "owner@example.org" },
  });
  const response = await GET(request("?days=3"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual([
    "days",
    "topPages",
    "topReferrers",
  ]);
  expect(body.days).toHaveLength(3);
  expect(body.days.at(-1)).toEqual({ date: today, visits: 3, uniques: 2 });
  expect(body.days[0]).toMatchObject({ visits: 0, uniques: 0 });
  expect(body.topPages).toEqual([{ path: "/", visits: 3, uniques: 2 }]);
  expect(body.topReferrers).toEqual([
    { host: "example.org", visits: 2, uniques: 1 },
  ]);
  // The window length is a bound parameter, never part of the SQL text.
  for (const call of mocks.query.mock.calls)
    if (String(call[0]).includes("page_views"))
      expect(call[1]).toEqual([3]);
});

it.each(["?days=0", "?days=91", "?days=abc"])(
  "rejects invalid days %s with 400",
  async (query) => {
    mocks.auth.mockResolvedValue({
      user: { id: "u1", email: "owner@example.org" },
    });
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "days must be an integer between 1 and 90",
    });
  },
);

it("defaults to the last 14 days", async () => {
  mocks.auth.mockResolvedValue({
    user: { id: "u1", email: "owner@example.org" },
  });
  const body = await (await GET(request())).json();
  expect(body.days).toHaveLength(14);
});