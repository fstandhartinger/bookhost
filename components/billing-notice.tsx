import { billingNotice, type BillingState } from "@/lib/trial";
import React from "react";
import { ActionButton } from "./action-button";
export function BillingNotice({
  subscription,
  role = "owner",
  compact = false,
}: {
  subscription: BillingState | null;
  role?: "owner" | "admin" | "member";
  compact?: boolean;
}) {
  const baseNotice = billingNotice(subscription, new Date(), role);
  const notice =
    role === "member"
      ? {
          ...baseNotice,
          action: "none" as const,
          text: "Billing is managed by the team owner.",
        }
      : baseNotice;
  if (!notice) return null;
  if (compact && !notice.urgent) return null;
  if (notice.kind === "active")
    return <p className="mt-5 text-sm text-slate-600">{notice.text}</p>;
  return (
    <div
      role="status"
      className={`mt-6 rounded-xl border p-5 ${notice.urgent ? "border-red-300 bg-red-50 text-red-900" : "border-teal-200 bg-teal-50 text-teal-900"}`}
    >
      <p className="font-medium">{notice.text}</p>
      {notice.action !== "none" && (
        <ActionButton
          endpoint={
            notice.action === "checkout" ? "/api/checkout" : "/api/portal"
          }
          className="button-secondary mt-3"
        >
          {notice.action === "checkout"
            ? "Resume workspace"
            : notice.kind.startsWith("trial")
              ? "Add a payment method"
              : "Manage billing"}
        </ActionButton>
      )}
    </div>
  );
}
