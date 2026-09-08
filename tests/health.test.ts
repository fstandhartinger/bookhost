import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { query } }));
import { GET } from "@/app/healthz/route";
it("reports failure without throwing and recovers on the next request", async () => {
  query.mockRejectedValueOnce(new Error("connection unavailable"));
  expect((await GET()).status).toBe(503);
  query.mockResolvedValueOnce({ rows: [] });
  expect((await GET()).status).toBe(200);
});
