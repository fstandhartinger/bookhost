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
  it("handles exact expiry, cancellation, payment and missing subscription honestly", () => {
    expect(billingNotice(sub, end)?.kind).toBe("trial_ended");
    expect(billingNotice({ ...sub, status: "canceled" }, end)?.kind).toBe(
      "subscription_ended",
    );
    expect(billingNotice({ ...sub, status: "active" }, end)?.text).toContain(
      "€39 + VAT",
    );
    expect(
      billingNotice(
        { ...sub, status: "active", cancel_at_period_end: true },
        end,
      )?.text,
    ).toContain("no further invoice");
    expect(
      billingNotice({ ...sub, status: "active", invoice_amount: "€19.50" }, end)
        ?.text,
    ).toContain("€19.50");
    expect(
      billingNotice(
        { ...sub, has_payment_method: true },
        new Date(end.getTime() - 1000),
      )?.action,
    ).toBe("none");
    expect(
      billingNotice(
        { ...sub, desired_state: "suspended" },
        new Date(end.getTime() - 1000),
      )?.kind,
    ).toBe("syncing");
    expect(billingNotice({ ...sub, status: "past_due" }, end)?.kind).toBe(
      "payment_failed",
    );
    expect(billingNotice(null)?.kind).toBe("no_subscription");
  });
  it("describes payment grace before suspension and eligibility follows its deadline", () => {
    const graceUntil = new Date(end.getTime() + 7 * 86400000);
    const delinquent = {
      ...sub,
      status: "past_due",
      payment_grace_started_at: end,
      payment_grace_until: graceUntil,
      payment_failure_notified_at: end,
    } as unknown as Parameters<typeof billingNotice>[0];
    expect(billingNotice(delinquent, end)).toMatchObject({
      kind: "payment_failed",
      urgent: true,
    });
    expect(billingNotice(delinquent, end)?.text).toContain("7 days");
  });
  it("skips a run when another database transaction owns the lock", async () => {
    const query = vi.fn(async () => ({ rows: [{ acquired: false }] }));
    expect(await generateNotifications({ query } as unknown as Queryable)).toBe(
      0,
    );
    expect(query).toHaveBeenCalledTimes(1);
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
