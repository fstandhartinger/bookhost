import { invoicePreview } from "@/lib/invoice-preview";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { BillingNotice } from "@/components/billing-notice";
import { db } from "@/lib/db";
export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fapp%2Fbilling");
  const subscription = (
    await db.query(
      `SELECT s.*,n.desired_state,n.status AS tenant_status FROM teams t
    LEFT JOIN effective_subscriptions s ON s.team_id=t.id LEFT JOIN tenants n ON n.team_id=t.id
    WHERE t.owner_user_id=$1`,
      [session.user.id],
    )
  ).rows[0];
  if (subscription?.status === "active" && !subscription.cancel_at_period_end)
    subscription.invoice_amount = await invoicePreview(
      subscription.stripe_subscription_id,
    );
  return (
    <section className="py-14">
      <h1 className="text-3xl">Manage billing</h1>
      <BillingNotice
        subscription={subscription?.status ? subscription : null}
      />
      <p className="my-5">
        Update your payment method and view invoices securely in the billing
        portal.
      </p>
      <ActionButton endpoint="/api/portal">Open billing portal</ActionButton>
      <a className="ml-4 underline" href="/app">
        Your workspace
      </a>
    </section>
  );
}
