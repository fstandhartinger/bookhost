export type BillingState = {
  status: string;
  trial_end: Date | string | null;
  current_period_end: Date | string | null;
  desired_state?: string;
  stripe_subscription_id?: string;
};
export const billingDate = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export function billingNotice(s: BillingState, now = new Date()) {
  if (s.status === "past_due" || s.status === "unpaid")
    return {
      urgent: true,
      text: "Your payment failed. Update your payment method to keep your workspace.",
      kind: "payment_failed",
    };
  if (s.status === "active")
    return s.current_period_end
      ? {
          urgent: false,
          text: `Next invoice: ${billingDate(s.current_period_end)}, €46.41 incl. VAT`,
          kind: "active",
        }
      : null;
  if (!s.trial_end) return null;
  const left = new Date(s.trial_end).getTime() - now.getTime();
  if (left <= 0)
    return s.desired_state === "suspended"
      ? {
          urgent: true,
          text: "Trial ended — workspace suspended. Add a payment method to resume.",
          kind: "trial_ended",
        }
      : null;
  if (s.status !== "trialing") return null;
  const days = Math.ceil(left / 86400000);
  return {
    urgent: left <= 3 * 86400000,
    text: `Your free trial ends in ${days} ${days === 1 ? "day" : "days"} (${billingDate(s.trial_end)}). Add a payment method to keep your workspace.`,
    kind:
      left <= 86400000
        ? "trial_ending_1d"
        : left <= 3 * 86400000
          ? "trial_ending_3d"
          : "trial",
  };
}
