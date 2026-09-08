import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
import { db } from "@/lib/db";
import { POST } from "@/app/api/cancel/route";
import { cancellationRateLimit } from "@/lib/cancellation";
let counter = 0;
function request(data: unknown, extra: Record<string, string> = {}) {
  return new Request("https://wissen.app.mintapis.com/api/cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `test-${++counter}`,
      ...extra,
    },
    body: JSON.stringify(data),
  });
}
beforeEach(() => {
  vi.mocked(db.query).mockReset();
  vi.mocked(db.query).mockResolvedValue({
    rows: [{ id: "receipt-1", created_at: new Date("2026-09-08T12:34:56Z") }],
  } as never);
});
describe("Public cancellation", () => {
  it.each(["cancel", "withdrawal"])(
    "stores %s and returns an escaped downloadable dated receipt without authentication",
    async (kind) => {
      const response = await POST(
        request({
          email: " Customer@example.com ",
          kind,
          team: "demo",
          note: "<script>alert(1)</script>",
        }),
      );
      expect(response.status).toBe(201);
      const body = await response.text();
      expect(body).toContain("2026-09-08T12:34:56.000Z");
      expect(body).toContain('download="wissen-confirmation.txt"');
      expect(body).not.toContain("<script>");
      expect(body).toContain("&lt;script&gt;");
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO cancellation_requests"),
        [
          "customer@example.com",
          "team: demo\nnote: <script>alert(1)</script>",
          kind,
        ],
      );
    },
  );
  it("accepts the native browser form", async () => {
    const response = await POST(
      new Request("https://wissen.app.mintapis.com/api/cancel", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": "native-form",
        },
        body: "email=test%40example.com&kind=cancel",
      }),
    );
    expect(response.status).toBe(201);
  });
  it.each([
    { email: "bad", kind: "cancel" },
    { email: "x@example.com", kind: "delete" },
    null,
    { email: "x@example.com", kind: "cancel", note: "x".repeat(2001) },
  ])("rejects invalid input before storing", async (data) => {
    expect((await POST(request(data))).status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("rejects cross-origin submissions", async () => {
    expect(
      (
        await POST(
          request(
            { email: "x@example.com", kind: "cancel" },
            { origin: "https://unrelated.example" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });
  it("does not claim receipt when storage fails", async () => {
    vi.mocked(db.query).mockRejectedValueOnce(
      new Error("private database details"),
    );
    const response = await POST(
      request({ email: "x@example.com", kind: "cancel" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database");
  });
  it("limits an IP to five submissions and returns Retry-After", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await POST(
            request(
              { email: "x@example.com", kind: "cancel" },
              { "x-forwarded-for": "limited-route" },
            ),
          )
        ).status,
      ).toBe(201);
    const blocked = await POST(
      request(
        { email: "x@example.com", kind: "cancel" },
        { "x-forwarded-for": "limited-route" },
      ),
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(db.query).toHaveBeenCalledTimes(5);
  });
  it("expires the in-memory limit after one hour", () => {
    for (let i = 0; i < 5; i++)
      expect(cancellationRateLimit("expiry", 1000)).toBe(true);
    expect(cancellationRateLimit("expiry", 1001)).toBe(false);
    expect(cancellationRateLimit("expiry", 3_601_000)).toBe(true);
  });
});
