import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ query: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: mocks.query } }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
}));
import { dailyHasher, isAdmin } from "@/lib/analytics/server";
import {
  automatedAgent,
  parseUtm,
  referrerHost,
  publicPath,
  ownHost,
} from "@/lib/analytics/shared";
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
      origin: "https://bookhost.co",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "x-real-ip": "192.0.2.1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
it.each([
  {
    name: "HeadlessChrome",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    expected: true,
  },
  {
    name: "Googlebot",
    userAgent:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    expected: true,
  },
  { name: "curl", userAgent: "curl/8.5.0", expected: true },
  {
    name: "python-requests",
    userAgent: "python-requests/2.32",
    expected: true,
  },
  { name: "empty user agent", userAgent: "", expected: true },
  { name: "missing user agent", userAgent: null, expected: true },
  {
    name: "desktop Chrome on Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    expected: false,
  },
  {
    name: "Firefox on Linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    expected: false,
  },
  {
    name: "iPhone Safari",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    expected: false,
  },
  {
    name: "Android Chrome mobile",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    expected: false,
  },
])("classifies $name user agents", ({ userAgent, expected }) => {
  expect(automatedAgent(userAgent)).toBe(expected);
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
it("skips automated browser beacons but records a normal same-origin browser", async () => {
  await POST(
    request(undefined, {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    }),
  );
  expect(
    mocks.query.mock.calls.some(([sql]) => String(sql).startsWith("INSERT")),
  ).toBe(false);

  mocks.query.mockClear();
  await POST(request());
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      String(sql).startsWith("INSERT INTO page_views"),
    ),
  ).toBe(true);
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
  mocks.query.mockImplementation(async (sql: string) => {
    if (String(sql).includes("email_verified_at"))
      return {
        rows: [{ email: "owner@example.org", email_verified_at: new Date() }],
      };
    if (String(sql).includes("SELECT path,"))
      return {
        rows: [
          { path: "/", visits: 3, uniques: 2 },
          { path: "/pricing", visits: 1, uniques: 1 },
        ],
      };
    if (String(sql).includes("referrer_host AS host")) return { rows: [] };
    return {
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
          paid_conversion: 1,
        },
      ],
    };
  });
  const report = await analyticsReport({ query: mocks.query });
  expect(report.sources[0]).toMatchObject({
    source: "test",
    visits: 2,
    demo_click: 1,
    paid_conversion: 1,
  });
  expect(report.days).toHaveLength(14);
  expect(report.days.at(-1)).toMatchObject({ day, visits: 2, paid_conversion: 1 });
  // Top pages share the same window: visits counts every beacon row, uniques
  // the daily hashes behind them; SQL orders by visits DESC, then path.
  expect(report.pages).toEqual([
    { path: "/", visits: 3, uniques: 2 },
    { path: "/pricing", visits: 1, uniques: 1 },
  ]);
  const pagesSql = mocks.query.mock.calls.find(([sql]) =>
    String(sql).includes("SELECT path,"),
  )?.[0] as string;
  expect(pagesSql).toContain("count(DISTINCT visitor_hash)::int AS uniques");
  expect(pagesSql).toContain("ORDER BY 2 DESC, 1 LIMIT 25");
  const funnelSql = mocks.query.mock.calls.find(([sql]) =>
    String(sql).includes("FROM events"),
  )?.[0] as string;
  expect(funnelSql).toContain("name='paid_conversion'");
  // The operator dashboard shows the full funnel, including the paid step.
  vi.stubEnv("ADMIN_EMAILS", "owner@example.org");
  mocks.auth.mockResolvedValue({
    user: { id: "op-1", email: "owner@example.org" },
  });
  expect(renderToStaticMarkup(await StatsPage())).toContain("paid conversion");
});

it("does not count our own pages as a referring site", () => {
  // Page-to-page navigation would otherwise bury the channels we care about,
  // such as the listing in the BookStack installation docs.
  expect(referrerHost("https://bookhost.co/pricing")).toBeNull();
  expect(referrerHost("https://demo.bookhost.co/")).toBeNull();
  expect(referrerHost("https://qa-third-0910.bookhost.co/")).toBeNull();
  expect(referrerHost("https://wissen.app.mintapis.com/")).toBeNull();
  expect(ownHost("bookhost.co")).toBe(true);
  expect(ownHost("notbookhost.co")).toBe(false);
});

it("keeps a genuine external referrer", () => {
  expect(referrerHost("https://www.bookstackapp.com/docs/admin/installation/")).toBe(
    "www.bookstackapp.com",
  );
});
