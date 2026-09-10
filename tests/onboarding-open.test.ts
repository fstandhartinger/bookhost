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
import { GET } from "@/app/api/bookstack/open/route";
const request = (id = "12345678-1234-1234-1234-123456789abc") =>
  new Request(`http://localhost/api/bookstack/open?team=${id}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
});
it("requires a session before tracking", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET(request())).headers.get("location")).toBe(
    "http://localhost/login",
  );
  expect(mocks.query).not.toHaveBeenCalled();
});
it("rejects malformed UUIDs without a database query", async () => {
  expect((await GET(request("-".repeat(36)))).status).toBe(404);
  expect(mocks.query).not.toHaveBeenCalled();
});
it("does not track a non-member", async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.query.mock.calls[0][1][1]).toBe("owner");
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("does not track a suspended workspace", async () => {
  mocks.query
    .mockResolvedValueOnce({
      rows: [
        {
          slug: "fixture",
          host: "fixture.wissen.app.mintapis.com",
          status: "running",
          desired_state: "suspended",
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ status: "active" }] });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("tracks an available workspace and redirects only to its tenant host", async () => {
  mocks.query
    .mockResolvedValueOnce({
      rows: [
        {
          slug: "fixture",
          host: "fixture.wissen.app.mintapis.com",
          status: "running",
          desired_state: "running",
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        { status: "trialing", trial_end: new Date(Date.now() + 86400000) },
      ],
    });
  const query = vi.fn();
  mocks.transaction.mockImplementation(async (fn) => fn({ query }));
  const response = await GET(request());
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe(
    "https://fixture.wissen.app.mintapis.com",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(query).toHaveBeenCalledTimes(2);
  expect(mocks.onboarding).toHaveBeenCalledOnce();
});
