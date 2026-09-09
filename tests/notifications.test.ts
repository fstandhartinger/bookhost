import { afterEach, describe, expect, it, vi } from "vitest";
import { billingNotice } from "../lib/trial";
import { generateNotifications, markNoticeRead } from "../lib/notifications";
import type { Queryable } from "../lib/billing";
const end = new Date("2026-10-15T12:00:00Z");
const sub = {
  status: "trialing",
  trial_end: end,
  current_period_end: end,
  stripe_subscription_id: "sub_fixture",
  desired_state: "running",
};
afterEach(() => vi.useRealTimers());
describe("trial thresholds", () => {
  it.each([
    [3 * 86400000 + 1, "trial", false],
    [3 * 86400000, "trial_ending_3d", true],
    [2 * 86400000, "trial_ending_3d", true],
    [86400000, "trial_ending_1d", true],
    [1, "trial_ending_1d", true],
  ])("remaining %i ms", (left, kind, urgent) => {
    vi.useFakeTimers();
    vi.setSystemTime(end.getTime() - left);
    expect(billingNotice(sub)).toMatchObject({ kind, urgent });
  });
  it("only reports suspended once the webhook requests it", () => {
    expect(billingNotice(sub, end)).toBeNull();
    expect(
      billingNotice(
        { ...sub, status: "canceled", desired_state: "suspended" },
        end,
      )?.kind,
    ).toBe("trial_ended");
    expect(billingNotice({ ...sub, status: "active" }, end)?.text).toContain(
      "€46.41 incl. VAT",
    );
    expect(billingNotice({ ...sub, status: "past_due" }, end)?.kind).toBe(
      "payment_failed",
    );
  });
  it("deduplicates each user/kind/period including concurrent runs and mail", async () => {
    const keys = new Set();
    const query = vi.fn(async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith("SELECT"))
        return {
          rows: [
            { ...sub, owner_user_id: "user", email: "test@example.invalid" },
          ],
        };
      const key = JSON.stringify(args.slice(0, 3));
      if (keys.has(key)) return { rowCount: 0 };
      keys.add(key);
      return { rowCount: 1 };
    });
    const db = { query } as unknown as Queryable;
    const mail = vi.fn();
    const now = new Date(end.getTime() - 2 * 86400000);
    expect(
      await Promise.all([
        generateNotifications(db, now, mail),
        generateNotifications(db, now, mail),
      ]),
    ).toEqual([1, 0]);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(
      await generateNotifications(db, new Date(end.getTime() - 86400000), mail),
    ).toBe(1);
  });
  it("scopes read updates to authenticated owner", async () => {
    const query = vi.fn();
    await markNoticeRead({ query } as unknown as Queryable, "owner", "notice");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("AND user_id=$2"),
      ["notice", "owner"],
    );
  });
});
