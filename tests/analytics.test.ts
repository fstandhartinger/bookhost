import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: mocks.query } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
import { dailyHasher, isAdmin } from "@/lib/analytics/server";
import { parseUtm, referrerHost, publicPath } from "@/lib/analytics/shared";
import { POST } from "@/app/api/track/route";
import StatsPage from "@/app/admin/stats/page";
import { analyticsReport } from "@/scripts/analytics-report.mjs";
beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.query.mockReset();
  mocks.auth.mockReset();
  mocks.query.mockResolvedValue({ rows: [{ hits: 1 }] });
});
it("deduplicates within a UTC date, separates callers and destroys old-day linkage", () => {
  const hash = dailyHasher();
  const day = new Date("2026-09-09T12:00:00Z");
  const a = hash("192.0.2.1", "browser", day);
  expect(hash("192.0.2.1", "browser", day)).toBe(a);
  expect(hash("192.0.2.2", "browser", day)).not.toBe(a);
  expect(hash("192.0.2.1", "different", day)).not.toBe(a);
  expect(
    hash("192.0.2.1", "browser", new Date("2026-09-10T00:00:00Z")),
  ).not.toBe(a);
  expect(hash("192.0.2.1", "browser", day)).not.toBe(a);
});
it("sanitizes UTM labels and excludes private paths and referrer secrets", () => {
  expect(
    parseUtm(
      new URLSearchParams(
        "utm_source=Reddit&utm_medium=social&utm_campaign=pilot-1",
      ),
    ),
  ).toEqual({
    utm_source: "reddit",
    utm_medium: "social",
    utm_campaign: "pilot-1",
  });
  expect(
    parseUtm(
      new URLSearchParams(
        "utm_source=a%40b.com&utm_campaign=" + "x".repeat(81),
      ),
    ).utm_source,
  ).toBeNull();
  expect(publicPath("/welcome?session_id=secret")).toBeNull();
  expect(publicPath("/app/intake")).toBeNull();
  expect(referrerHost("https://example.org/private?token=secret")).toBe(
    "example.org",
  );
});
const request = (
  body: unknown = { path: "/", utm_source: "test" },
  headers = {},
) =>
  new Request("http://localhost/api/track", {
    method: "POST",
    headers: {
      origin: "https://wissen.app.mintapis.com",
      "x-real-ip": "192.0.2.1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
it("stores only a daily hash, sanitized campaign and host", async () => {
  expect(
    (
      await POST(
        request({
          path: "/",
          utm_source: "Test",
          referrer: "https://example.org/?secret=1",
        }),
      )
    ).status,
  ).toBe(204);
  const call = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO page_views"),
  );
  expect(call?.[1]).toEqual([
    "/",
    "example.org",
    "test",
    null,
    null,
    expect.stringMatching(/^[a-f0-9]{64}$/),
  ]);
  expect(JSON.stringify(mocks.query.mock.calls)).not.toContain("192.0.2.1");
});
it("enforces database rate limit before inserting", async () => {
  mocks.query.mockResolvedValue({ rows: [{ hits: 61 }] });
  expect((await POST(request())).status).toBe(204);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][1]).toEqual([
    expect.stringMatching(/^analytics:/),
    60,
  ]);
});
it.each([
  { dnt: "1" },
  { "sec-gpc": "1" },
  { origin: "https://other.invalid" },
])("skips opted-out and foreign-origin beacons %s", async (headers) => {
  expect((await POST(request(undefined, headers))).status).toBe(204);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("rejects oversized payloads and forged business events", async () => {
  await POST(request({ path: "/", payload: "x".repeat(3000) }));
  await POST(request({ path: "/", name: "trial_started" }));
  expect(
    mocks.query.mock.calls.every(
      ([sql]) =>
        !sql.includes("INSERT INTO events") &&
        !sql.includes("INSERT INTO page_views"),
    ),
  ).toBe(true);
});
it("admin gate denies missing/unlisted users with 404 before DB access", async () => {
  vi.stubEnv("ADMIN_EMAILS", " Owner@example.org, second@example.org ");
  expect(isAdmin("owner@example.org")).toBe(true);
  expect(isAdmin("other@example.org")).toBe(false);
  for (const session of [null, { user: { email: "other@example.org" } }]) {
    mocks.auth.mockResolvedValue(session);
    await expect(StatsPage()).rejects.toThrow("404");
  }
  expect(mocks.query).not.toHaveBeenCalled();
  vi.stubEnv("ADMIN_EMAILS", "");
  expect(isAdmin("owner@example.org")).toBe(false);
});
it("shares consistent source/day totals with zero-filled daily series", async () => {
  const day = new Date().toISOString().slice(0, 10);
  mocks.query.mockResolvedValue({
    rows: [
      {
        day,
        source: "test",
        visits: 2,
        demo_click: 1,
        checkout_start: 1,
        trial_started: 0,
        workspace_created: 0,
        intake_draft: 0,
        intake_published: 0,
      },
    ],
  });
  const report = await analyticsReport({ query: mocks.query });
  expect(report.sources[0]).toMatchObject({
    source: "test",
    visits: 2,
    demo_click: 1,
  });
  expect(report.days).toHaveLength(14);
  expect(report.days.at(-1)).toMatchObject({ day, visits: 2 });
});
