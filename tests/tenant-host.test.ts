import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  onboarding: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/db", () => ({
  db: { query: mocks.query },
  transaction: mocks.transaction,
}));
vi.mock("@/lib/onboarding", () => ({ onboarding: mocks.onboarding }));
import { BookStack } from "@/lib/intake/bookstack";
import { GET as open } from "@/app/api/bookstack/open/route";
import { GET, POST } from "@/app/api/intake/[id]/route";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id } });
  mocks.transaction.mockImplementation(async (fn) => fn({ query: vi.fn() }));
});
it.each([
  "different.bookhost.co",
  "demo.wissen.app.mintapis.com",
  "wiki.example.org",
])("uses stored client host %s", async (host) => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response('{"data":[],"total":0}'));
  try {
    const client = new BookStack(host, "id", "secret");
    expect(client.base).toBe(`https://${host}`);
    await client.list("books");
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://${host}/api/books?count=500&offset=0`,
    );
  } finally {
    fetcher.mockRestore();
  }
});
it.each(["different.bookhost.co", "fixture.wissen.app.mintapis.com"])(
  "opens stored tenant host %s",
  async (host) => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            slug: "fixture",
            host,
            status: "running",
            desired_state: "running",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ status: "active" }] });
    expect(
      (
        await open(
          new Request(`https://bookhost.co/api/bookstack/open?team=${id}`),
        )
      ).headers.get("location"),
    ).toBe(`https://${host}`);
    expect(mocks.query.mock.calls[0][0]).toContain("n.host");
  },
);
it.each(["different.bookhost.co", "fixture.wissen.app.mintapis.com"])(
  "uses stored host for intake read and already-published link %s",
  async (host) => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          id,
          slug: "fixture",
          host,
          role: "admin",
          status: "published",
          tenant_status: "running",
          desired_state: "running",
          subscription_status: "active",
          bookstack_page_id: 42,
        },
      ],
    });
    const request = new Request(`https://bookhost.co/api/intake/${id}`, {
      method: "POST",
      headers: {
        origin: "https://bookhost.co",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "publish" }),
    });
    const ctx = { params: Promise.resolve({ id }) };
    expect((await (await GET(request, ctx)).json()).url).toBe(
      `https://${host}/link/42`,
    );
    expect((await (await POST(request, ctx)).json()).url).toBe(
      `https://${host}/link/42`,
    );
    expect(mocks.query.mock.calls[0][0]).toContain("t.host");
  },
);
it.each(["x.bookhost.co", "x.wissen.app.mintapis.com", "bookhost.co"])(
  "preserves %s",
  (host) => {
    expect(
      middleware(
        new NextRequest(`https://${host}/login`, { headers: { host } }),
      ).status,
    ).toBe(200);
  },
);
it.each(["www.bookhost.co", "bookhost.cloud", "www.bookhost.site"])(
  "redirects marketing host %s",
  (host) => {
    const response = middleware(
      new NextRequest(`https://${host}/pricing?x=1`, { headers: { host } }),
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://bookhost.co/pricing?x=1",
    );
  },
);

it("stores the new workspace host when inserting the pending tenant", async () => {
  const { POST: create } = await import("@/app/api/tenants/route");
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id }] })
    .mockResolvedValueOnce({ rowCount: 1 })
    .mockResolvedValueOnce({ rowCount: 0 })
    .mockResolvedValue({ rows: [] });
  mocks.transaction.mockImplementation(async (fn) => fn({ query }));
  const response = await create(
    new Request("https://bookhost.co/api/tenants", {
      method: "POST",
      headers: {
        origin: "https://bookhost.co",
        "content-type": "application/json",
      },
      body: JSON.stringify({ slug: "new-team" }),
    }),
  );
  expect(response.status).toBe(201);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("admin_email,host)"),
    [id, "new-team", undefined, "new-team.bookhost.co"],
  );
});
it.each([
  "https://foo.example.org",
  "foo.example.org/path",
  "foo.example.org:443",
  "foo@bar.example.org",
  "foo.example.org?x=1",
  "foo.example.org#x",
  "-foo.example.org",
  "foo..example.org",
])("rejects malformed stored host %s", (host) => {
  expect(() => new BookStack(host, "id", "secret")).toThrow();
});
