import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
import { db } from "@/lib/db";
import { auth } from "@/auth";
import { acquireSlot } from "@/lib/intake/slots";
import { POST } from "@/app/api/intake/route";
import { recoverIntake } from "@/lib/intake/jobs";
import { workspace } from "@/lib/intake/access";
import { quota } from "@/lib/intake/quota";
const tenant = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.mocked(db.query).mockReset();
});
it("rejects a third upload before reading its body and releases slots once", async () => {
  vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
  vi.mocked(db.query).mockResolvedValue({
    rows: [
      {
        id: tenant,
        status: "running",
        desired_state: "running",
        subscription_status: "trialing",
      },
    ],
  } as never);
  const first = acquireSlot("team-a")!,
    second = acquireSlot("team-b")!;
  try {
    const response = await POST(
      new Request(
        `https://bookhost.co/api/intake?tenant=${tenant}`,
        {
          method: "POST",
          headers: { origin: "https://bookhost.co" },
          body: "unread",
        },
      ),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
  } finally {
    first();
    first();
    second();
  }
  const a = acquireSlot("team-a")!,
    b = acquireSlot("team-b")!;
  expect(acquireSlot("team-c")).toBeNull();
  a();
  b();
});
it.each(["suspended", "pending"])(
  "denies desired %s before work",
  async (desired) => {
    vi.mocked(db.query).mockResolvedValue({
      rows: [
        {
          status: "running",
          desired_state: desired,
          subscription_status: "active",
        },
      ],
    } as never);
    await expect(workspace("user", tenant)).rejects.toMatchObject({
      status: 409,
    });
  },
);
it("returns 402 when atomic reservation loses a quota race", async () => {
  vi.mocked(db.query)
    .mockResolvedValueOnce({ rowCount: 0 } as never)
    .mockResolvedValueOnce({ rowCount: 0, rows: [] } as never);
  await expect(quota(tenant, "trialing", true)).rejects.toMatchObject({
    status: 402,
  });
  expect(db.query).toHaveBeenLastCalledWith(
    expect.stringContaining("used<draft_limit"),
    [tenant, "trial"],
  );
});
it("recovers stalled states and deletes expired items", async () => {
  vi.mocked(db.query).mockResolvedValue({ rowCount: 1 } as never);
  await recoverIntake();
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("'queued','drafting','approved'"),
  );
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("interval '30 days'"),
  );
});
