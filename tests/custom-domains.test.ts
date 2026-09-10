import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  txt: vi.fn(),
  cname: vi.fn(),
  a: vi.fn(),
  aaaa: vi.fn(),
  rate: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { query: mocks.query },
  transaction: (fn: (db: unknown) => unknown) => fn({ query: mocks.query }),
}));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolveTxt = mocks.txt;
    resolveCname = mocks.cname;
    resolve4 = mocks.a;
    resolve6 = mocks.aaaa;
    cancel() {}
  },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/security", () => ({
  sameOrigin: () => true,
  rateLimit: mocks.rate,
}));
import { validDomain, verifyDomain } from "@/lib/custom-domains";
import { POST, DELETE } from "@/app/api/domains/route";
import { POST as CHECK } from "@/app/api/domains/check/route";
const request = (body: object) =>
  new Request("https://bookhost.co/api/domains", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "user" } });
  mocks.rate.mockResolvedValue(true);
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.txt.mockResolvedValue([["token"]]);
  mocks.cname.mockResolvedValue(["team.bookhost.co"]);
  mocks.a.mockResolvedValue([]);
  mocks.aaaa.mockResolvedValue([]);
});
describe("customer domains", () => {
  it.each(["wiki.example.org", "docs.my-company.de"])("accepts %s", (host) =>
    expect(validDomain(host)).toBe(true),
  );
  it.each([
    "UP.example.org",
    "localhost",
    "*.example.org",
    "xn--bcher-kva.de",
    "x.xn--p1ai",
    "a..com",
    "-x.com",
    "a_.com",
    "127.0.0.1",
    "https://x.com",
    "x.com.",
    "bookhost.co",
    "wiki.bookhost.co",
    "wissen.app.mintapis.com",
    "x.bookhost.cloud",
    "bookhost.online",
    "bookhost.site",
  ])("rejects %s", (host) => expect(validDomain(host)).toBe(false));
  it("requires an exact TXT token", async () => {
    mocks.txt.mockResolvedValue([["wrong"]]);
    expect(
      await verifyDomain("wiki.example.org", "token", "team.bookhost.co"),
    ).toMatchObject({ verified: false, error: expect.stringContaining("TXT") });
  });
  it("joins TXT chunks", async () => {
    mocks.txt.mockResolvedValue([["to", "ken"]]);
    expect(
      await verifyDomain("wiki.example.org", "token", "team.bookhost.co"),
    ).toEqual({ verified: true });
  });
  it("rejects another CNAME", async () => {
    mocks.cname.mockResolvedValue(["other.example.org"]);
    expect(
      (await verifyDomain("wiki.example.org", "token", "team.bookhost.co"))
        .verified,
    ).toBe(false);
  });
  it("accepts configured A address", async () => {
    process.env.CUSTOM_DOMAIN_IPV4 = "203.0.113.10";
    mocks.cname.mockResolvedValue([]);
    mocks.a.mockResolvedValue(["203.0.113.10"]);
    expect(
      (await verifyDomain("wiki.example.org", "token", "team.bookhost.co"))
        .verified,
    ).toBe(true);
    delete process.env.CUSTOM_DOMAIN_IPV4;
  });
  it("denies members", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role: "member" }] });
    expect(
      (await POST(request({ team: "t", host: "wiki.example.org" }))).status,
    ).toBe(403);
    expect(
      (await CHECK(request({ team: "t", host: "wiki.example.org" }))).status,
    ).toBe(403);
  });
  it("enforces three domains", async () => {
    mocks.query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes("memberships")
          ? [{ role: "owner" }]
          : sql.includes("count(*)")
            ? [{ count: 3 }]
            : [{ id: "t", host: "team.bookhost.co", status: "running" }],
      }),
    );
    expect(
      (await POST(request({ team: "t", host: "wiki.example.org" }))).status,
    ).toBe(409);
  });
  it("rate limits per team before DNS", async () => {
    mocks.query.mockResolvedValue({ rows: [{ role: "admin" }] });
    mocks.rate.mockResolvedValue(false);
    expect(
      (await CHECK(request({ team: "t", host: "wiki.example.org" }))).status,
    ).toBe(429);
    expect(mocks.txt).not.toHaveBeenCalled();
  });
  it.each([false, true])("persists verification result %s", async (correct) => {
    mocks.query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes("memberships")
          ? [{ role: "owner" }]
          : [
              {
                host: "wiki.example.org",
                verification_token: "token",
                status: "pending_dns",
                tenant_host: "team.bookhost.co",
              },
            ],
      }),
    );
    mocks.txt.mockResolvedValue([[correct ? "token" : "wrong"]]);
    expect(
      (await CHECK(request({ team: "t", host: "wiki.example.org" }))).status,
    ).toBe(200);
    const update = mocks.query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE tenant_domains"),
    );
    expect(update?.[1]).toContain(correct ? "verified" : "pending_dns");
  });
});

it("bounds stalled DNS lookups to four seconds", async () => {
  vi.useFakeTimers();
  try {
    mocks.txt.mockImplementation(() => new Promise(() => {}));
    const pending = verifyDomain(
      "wiki.example.org",
      "token",
      "team.bookhost.co",
    );
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toMatchObject({
      verified: false,
      error: expect.stringContaining("timed out"),
    });
  } finally {
    vi.useRealTimers();
  }
});
it("creates a fresh 256-bit token for a valid request", async () => {
  mocks.query.mockImplementation((sql: string) =>
    Promise.resolve({
      rows: sql.includes("memberships")
        ? [{ role: "admin" }]
        : sql.includes("count(*)")
          ? [{ count: 0 }]
          : [{ host: "team.bookhost.co" }],
    }),
  );
  expect(
    (await POST(request({ team: "t", host: "wiki.example.org" }))).status,
  ).toBe(200);
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.includes("INSERT INTO tenant_domains"),
  );
  expect(insert?.[1][2]).toMatch(/^[0-9a-f]{64}$/);
});
it("handles a globally claimed host without exposing its owner", async () => {
  mocks.query.mockImplementation((sql: string) => {
    if (sql.includes("INSERT INTO tenant_domains")) throw { code: "23505" };
    return Promise.resolve({
      rows: sql.includes("memberships")
        ? [{ role: "owner" }]
        : sql.includes("count(*)")
          ? [{ count: 0 }]
          : [{ host: "team.bookhost.co" }],
    });
  });
  expect(
    (await POST(request({ team: "t", host: "wiki.example.org" }))).status,
  ).toBe(409);
});

it("members cannot withdraw a domain", async () => {
  mocks.query.mockResolvedValue({ rows: [{ role: "member" }] });
  expect(
    (await DELETE(request({ team: "t", host: "wiki.example.org" }))).status,
  ).toBe(403);
});
it("withdrawal queues durable removal instead of releasing the hostname", async () => {
  mocks.query.mockResolvedValue({ rows: [{ role: "owner" }] });
  expect(
    (await DELETE(request({ team: "t", host: "wiki.example.org" }))).status,
  ).toBe(200);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.includes("removal_requested_at=now()"),
    ),
  ).toBe(true);
  expect(
    mocks.query.mock.calls.some(([sql]) =>
      sql.includes("DELETE FROM tenant_domains"),
    ),
  ).toBe(false);
});

it("reports a missing workspace reference separately from an invalid domain", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile("lib/domain-api.ts", "utf8"),
  );
  expect(source).toContain("Missing workspace reference");
  const missingIndex = source.indexOf("Missing workspace reference");
  const domainIndex = source.indexOf("Enter a lowercase public domain");
  expect(missingIndex).toBeGreaterThan(-1);
  expect(domainIndex).toBeGreaterThan(missingIndex);
});

it("clears the retry backoff when the customer checks again", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile("lib/domain-api.ts", "utf8"),
  );
  expect(source).toMatch(/attempts=0,last_attempt_at=NULL/);
});

it("keeps document intake on the active team", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile("app/app/intake/page.tsx", "utf8"),
  );
  // The page must select the tenant of the team the dashboard shows.
  expect(source).toContain("ACTIVE_TEAM_COOKIE");
  expect(source).toMatch(/memberships\.find\(\(m\) => m\.team_id === activeTeam\)/);
  expect(source).toMatch(/FROM tenants t WHERE t\.team_id=\$1/);
});
