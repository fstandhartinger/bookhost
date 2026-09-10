import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { query } }));
import { quota } from "@/lib/intake/quota";
afterEach(() => {
  vi.useRealTimers();
  query.mockReset();
});
it.each([
  ["trialing", "trial", 20],
  ["active", "2026-10", 300],
] as const)(
  "reserves the last %s draft and rejects the next",
  async (status, period, limit) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ used: limit, draft_limit: limit }],
    });
    expect(await quota("team", status, true)).toEqual({
      remaining: 0,
      limit,
      period,
    });
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
      "team",
      period,
      limit,
    ]);
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 0 });
    await expect(quota("team", status, true)).rejects.toMatchObject({
      status: 402,
    });
  },
);
it("uses UTC calendar months, while trial never resets monthly", async () => {
  for (const [time, period] of [
    ["2026-09-30T23:59:59Z", "2026-09"],
    ["2026-10-01T00:00:00Z", "2026-10"],
  ]) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(time));
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ used: 0, draft_limit: 300 }],
    });
    expect((await quota("team", "active")).period).toBe(period);
    expect((await quota("team", "trialing")).period).toBe("trial");
  }
});
it("warns exactly at 80%, above included storage, and rejects stale or missing readings", async () => {
  const { storageNotice } = await import("@/lib/storage-usage");
  const now = new Date();
  expect(storageNotice(3_999_999_999, now)).toBeNull();
  expect(storageNotice(4_000_000_000, now)).toContain("80%");
  expect(storageNotice(6_000_000_000, now)).toContain(
    "not automatically blocked",
  );
  expect(storageNotice(null, null)).toContain("unavailable");
  expect(storageNotice(0, new Date(0))).toContain("out of date");
});
it.each([
  "content/legal/agb.md",
  "content/blog/bookstack-hosted-with-reviewed-document-intake.md",
])("published numbers and meaning agree with constants: %s", async (path) => {
  const { QUOTAS } = await import("@/lib/quotas");
  const text = readFileSync(path, "utf8");
  for (const n of [
    QUOTAS.members,
    QUOTAS.trialDrafts,
    QUOTAS.monthlyDrafts,
    QUOTAS.storageGB,
  ])
    expect(text).toMatch(new RegExp(`\\b${n}\\b`));
  expect(text).toMatch(/Dashboard|dashboard/);
  expect(text).toContain("UTC");
  expect(text).toMatch(new RegExp(`${QUOTAS.storageWarningRatio * 100}\\s*%`));
  const plain = text.replaceAll("**", "");
  expect(plain).toMatch(
    new RegExp(
      `${QUOTAS.members} BookHost[- ](?:Dashboard-Mitglieder|dashboard members)`,
    ),
  );
  expect(plain).toMatch(
    new RegExp(`${QUOTAS.storageGB} GB (?:Upload-Speicher|of uploads)`),
  );
  expect(plain).toMatch(
    new RegExp(
      `${QUOTAS.trialDrafts} (?:Entwürfe insgesamt während der Testphase|drafts in total)`,
    ),
  );
  expect(plain).toMatch(
    new RegExp(
      `${QUOTAS.monthlyDrafts} (?:Entwürfe je Kalendermonat|drafts per calendar month)`,
    ),
  );
  expect(text).not.toMatch(/25 users per workspace|25 Nutzer je Workspace/);
});
it("failed unfinished drafts refund their original reservation once, including recovery", () => {
  const sql = readFileSync("db/migrations/029_quota_truth.sql", "utf8");
  expect(sql).toContain("OLD.quota_period");
  expect(sql).toContain("NEW.status = 'failed'");
  expect(sql).toContain("OLD.draft_html IS NULL");
  expect(sql).toContain("NEW.quota_period := NULL");
});
it("homepage, pricing and landing copy render the canonical limits and meaning", async () => {
  const React = await import("react");
  vi.stubGlobal("React", React);
  try {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: Home } = await import("@/app/page");
    const { Pricing } = await import("@/components/pricing");
    const { default: BlogCta } = await import("@/components/blog-cta");
    const { MEMBER_COPY, STORAGE_COPY, DRAFT_COPY, QUOTAS } =
      await import("@/lib/quotas");
    const { faqs, benefits, steps } = await import("@/lib/landing-copy");
    const { PRODUCT_DESCRIPTION } = await import("@/lib/metadata");
    for (const component of [Home, Pricing]) {
      const html = renderToStaticMarkup(React.createElement(component));
      for (const copy of [MEMBER_COPY, STORAGE_COPY, DRAFT_COPY])
        expect(html).toContain(copy);
      expect(html).not.toContain("25 users per workspace");
    }
    const cta = renderToStaticMarkup(React.createElement(BlogCta));
    for (const copy of [MEMBER_COPY, STORAGE_COPY]) expect(cta).toContain(copy);
    const landing = JSON.stringify([faqs, benefits, steps]);
    for (const copy of [MEMBER_COPY, STORAGE_COPY, DRAFT_COPY])
      expect(landing).toContain(copy);
    expect(PRODUCT_DESCRIPTION).toContain(`${QUOTAS.trialDrafts} trial drafts`);
    expect(PRODUCT_DESCRIPTION).toContain(
      `${QUOTAS.monthlyDrafts}/calendar month (UTC)`,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
it("supports a configured storage warning threshold with safe defaults", async () => {
  const { storageNotice } = await import("@/lib/storage-usage");
  try {
    vi.stubEnv("STORAGE_WARNING_RATIO", "0.9");
    expect(storageNotice(4_000_000_000, new Date())).toBeNull();
    expect(storageNotice(4_500_000_000, new Date())).toContain("90%");
    vi.stubEnv("STORAGE_WARNING_RATIO", "invalid");
    expect(storageNotice(4_000_000_000, new Date())).toContain("80%");
  } finally {
    vi.unstubAllEnvs();
  }
});
