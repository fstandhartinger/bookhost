import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user" } })),
}));
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [{ id: "item" }] })) },
}));
vi.mock("@/lib/security", () => ({
  sameOrigin: () => true,
  rateLimit: async () => true,
}));
vi.mock("@/lib/intake/quota", () => ({
  quota: vi.fn(async () => ({ remaining: 10 })),
}));
vi.mock("@/lib/intake/jobs", () => ({ enqueue: vi.fn() }));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<typeof import("@/lib/intake/access")>()),
  workspace: async () => ({
    id: "tenant",
    team_id: "team",
    subscription_status: "trialing",
  }),
  clientFor: async () => new BookStack("demo.wissen.app.mintapis.com", "id", "secret"),
}));
import { BookStack } from "@/lib/intake/bookstack";
import { POST } from "@/app/api/intake/route";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/intake/jobs";
import { quota } from "@/lib/intake/quota";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function request() {
  const form = new FormData();
  form.set("tenant_id", "tenant");
  form.set("book_id", "new");
  form.set("new_book_name", "");
  form.set("chapter_id", "");
  form.set("file", new Blob(["Team notes"]), "Handbook.md");
  return new Request(
    "https://bookhost.co/api/intake?tenant=tenant",
    { method: "POST", body: form },
  );
}
it("accepts a multipart upload into a new book even without existing destinations", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ id: 23, name: "Handbook" }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request());
  try {
    expect(response.status).toBe(202);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      name: "Handbook",
    });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO intake_items"),
      ["team", "tenant", "Handbook.md", 23, null, "user", "Handbook", null],
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  } finally {
    const call = vi.mocked(enqueue).mock.calls[0];
    if (call) {
      await call[5]();
      call[6]();
    }
  }
});
it("returns a useful permission error without enqueuing or charging draft quota", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("private", { status: 403 })),
  );
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect((await response.json()).error).toContain("Create all books");
  expect(enqueue).not.toHaveBeenCalled();
  expect(quota).not.toHaveBeenCalledWith("team", "trialing", true);
});
