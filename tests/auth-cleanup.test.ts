import { expect, it, vi } from "vitest";
vi.mock("../lib/notifications", () => ({
  generateNotifications: vi.fn(async () => 0),
}));
vi.mock("@/lib/db", () => ({
  transaction: async (fn: (client: object) => Promise<unknown>) => fn({}),
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
import { db } from "../lib/db";
import { startAuthCleanup } from "../lib/auth-cleanup";
it("cleans expired rows at startup and hourly with only one timer per process", async () => {
  vi.useFakeTimers();
  try {
    startAuthCleanup();
    startAuthCleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.query).toHaveBeenCalledTimes(4);
    expect(db.query).toHaveBeenCalledWith(
      "DELETE FROM password_reset_tokens WHERE expires_at<now()",
    );
    expect(db.query).toHaveBeenCalledWith(
      "DELETE FROM rate_limits WHERE expires_at<now()",
    );
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(db.query).toHaveBeenCalledTimes(8);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
