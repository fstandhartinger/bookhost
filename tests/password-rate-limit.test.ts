import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
import { db } from "../lib/db";
import { rateLimit } from "../lib/security";
it("allows ten attempts and rejects the eleventh using a 15 minute atomic DB window", async () => {
  for (let hits = 1; hits <= 11; hits++) {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ hits }] } as never);
    expect(await rateLimit("test", 10, 900)).toBe(hits <= 10);
  }
  expect(db.query).toHaveBeenLastCalledWith(
    expect.stringContaining("make_interval(secs => $2)"),
    ["test", 900],
  );
});
