import { billingNotice, type BillingState } from "@/lib/trial";
import { ActionButton } from "./action-button";
export function BillingNotice({
  subscription,
  compact = false,
}: {
  subscription: BillingState | null;
  compact?: boolean;
}) {
  const notice = subscription && billingNotice(subscription);
  if (!notice || (compact && !notice.kind.startsWith("trial_ending")))
    return null;
  if (compact && !notice.urgent) return null;
  if (notice.kind === "active")
    return <p className="mt-5 text-sm text-slate-600">{notice.text}</p>;
  return (
    <div
      role="status"
      className={`mt-6 rounded-xl border p-5 ${notice.urgent ? "border-red-300 bg-red-50 text-red-900" : "border-teal-200 bg-teal-50 text-teal-900"}`}
    >
      <p className="font-medium">{notice.text}</p>
      <ActionButton endpoint="/api/portal" className="button-secondary mt-3">
        Add a payment method
      </ActionButton>
    </div>
  );
}
