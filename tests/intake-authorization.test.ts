import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/intake/[id]/route";
import { GET as list } from "@/app/api/intake/route";
const id = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id }) };
const req = (body: unknown) =>
  new Request(`https://wissen.app.mintapis.com/api/intake/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: "https://wissen.app.mintapis.com",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(db.query)
    .mockReset()
    .mockResolvedValue({ rows: [], rowCount: 0 } as never);
});
it("returns 404 for another team's document on read and publication", async () => {
  expect(
    (await GET(new Request("https://wissen.app.mintapis.com"), context)).status,
  ).toBe(404);
  expect(
    (
      await POST(
        req({ action: "publish", title: "x", html: "<p>x</p>" }),
        context,
      )
    ).status,
  ).toBe(404);
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("m.user_id=$2"),
    [id, "user-1"],
  );
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("t.team_id=i.team_id"),
    [id, "user-1"],
  );
});
it("returns 404 for another team's workspace before accessing API credentials", async () => {
  expect(
    (
      await list(
        new Request(`https://wissen.app.mintapis.com/api/intake?tenant=${id}`),
      )
    ).status,
  ).toBe(404);
  expect(db.query).toHaveBeenCalledTimes(1);
});
it("denies a member publishing even with a forged client request", async () => {
  vi.mocked(db.query).mockResolvedValue({
    rows: [{ id, role: "member", status: "draft", tenant_status: "running" }],
  } as never);
  expect(
    (
      await POST(
        req({ action: "publish", title: "x", html: "<p>x</p>" }),
        context,
      )
    ).status,
  ).toBe(403);
  expect(db.query).toHaveBeenCalledTimes(1);
});
it("refuses publication of a previously approved draft", async () => {
  vi.mocked(db.query).mockResolvedValue({
    rows: [{ id, role: "admin", status: "approved", tenant_status: "running" }],
  } as never);
  expect(
    (
      await POST(
        req({ action: "publish", title: "x", html: "<p>x</p>" }),
        context,
      )
    ).status,
  ).toBe(409);
  expect(db.query).toHaveBeenCalledTimes(1);
});
it("requires authentication and rejects cross-origin mutations before any DB read", async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  expect((await GET(req({}), context)).status).toBe(401);
  expect(
    (
      await POST(
        new Request("https://wissen.app.mintapis.com/api/intake/" + id, {
          method: "POST",
          headers: { origin: "https://other.example" },
        }),
        context,
      )
    ).status,
  ).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});
