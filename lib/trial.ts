export const WORKSPACE_UNAVAILABLE_MESSAGE =
  "Your previous workspace is unavailable. Contact support at info@productivity-boost.com before starting another subscription; payment cannot restore deleted data.";
export type BillingState = {
  status: string;
  trial_end: Date | string | null;
  current_period_end: Date | string | null;
  cancel_at_period_end?: boolean;
  has_payment_method?: boolean;
  desired_state?: string;
  tenant_status?: string;
  tenant_error?: string | null;
  stripe_subscription_id?: string;
  invoice_amount?: string | null;
};
export const billingDate = (value: Date | string) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
export function billingEligible(
  s: BillingState | null | undefined,
  now = new Date(),
) {
  return Boolean(
    s &&
    (s.status === "active" ||
      (s.status === "trialing" && s.trial_end && new Date(s.trial_end) > now)),
  );
}
export function billingNotice(
  s: BillingState | null,
  now = new Date(),
  role: "owner" | "admin" | "member" = "owner",
) {
  if (role === "member" && !s)
    return {
      urgent: true,
      kind: "member",
      action: "none" as const,
      text: "Billing is managed by the team owner.",
    };
  if (s?.tenant_error === "workspace_unavailable")
    return {
      urgent: true,
      kind: "workspace_unavailable",
      action: "none",
      text: WORKSPACE_UNAVAILABLE_MESSAGE,
    };
  if (!s)
    return {
      urgent: true,
      kind: "no_subscription",
      text: "No subscription is linked to this workspace. Start checkout to restore access.",
      action: "checkout",
    };
  if (s.status === "past_due" || s.status === "unpaid")
    return {
      urgent: true,
      kind: "payment_failed",
      action: "portal",
      text: "Your payment failed. Workspace access is suspended. Update your payment method and pay the outstanding invoice to restore access.",
    };
  if (s.status === "active") {
    if (s.desired_state === "suspended" || s.tenant_status === "suspended")
      return {
        urgent: true,
        kind: "syncing",
        action: "none",
        text: "Your subscription is active. Workspace access is being restored.",
      };
    return {
      urgent: false,
      kind: "active",
      action: "none",
      text: s.cancel_at_period_end
        ? `Ends on ${s.current_period_end ? billingDate(s.current_period_end) : "the end of this billing period"}, no further invoice.`
        : `Next invoice${s.current_period_end ? `: ${billingDate(s.current_period_end)}` : ""}, ${s.invoice_amount || "€39 + VAT"}.`,
    };
  }
  if (s.status === "trialing") {
    const left = s.trial_end
      ? new Date(s.trial_end).getTime() - now.getTime()
      : 0;
    if (left <= 0)
      return {
        urgent: true,
        kind: "trial_ended",
        action: "portal",
        text: "Your trial has ended. Workspace access is suspended while billing is confirmed. If the subscription has ended, resume checkout from your dashboard.",
      };
    if (s.desired_state === "suspended" || s.tenant_status === "suspended")
      return {
        urgent: true,
        kind: "syncing",
        action: "none",
        text: "Your trial is still valid. Workspace access is being restored.",
      };
    const days = Math.ceil(left / 86400000);
    return {
      urgent: left <= 3 * 86400000,
      kind:
        left <= 86400000
          ? "trial_ending_1d"
          : left <= 3 * 86400000
            ? "trial_ending_3d"
            : "trial",
      action: s.has_payment_method ? "none" : "portal",
      text: `Your free trial ends in ${days} ${days === 1 ? "day" : "days"} (${billingDate(s.trial_end!)} UTC). ${s.cancel_at_period_end ? "Your subscription will end; no further invoice." : s.has_payment_method ? "A payment method is on file. Billing starts after the trial." : "Add a payment method to keep your workspace."}`,
    };
  }
  return {
    urgent: true,
    kind: "subscription_ended",
    action: ["canceled", "incomplete_expired"].includes(s.status)
      ? "checkout"
      : "portal",
    text: "Your subscription has ended or is suspended. Resume workspace with a paid subscription; there is no new free trial. Access returns after payment is confirmed.",
  };
}
