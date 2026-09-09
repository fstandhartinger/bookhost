import { BillingNotice } from "@/components/billing-notice";
import React from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Intake } from "@/components/intake";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Document intake",
  robots: { index: false, follow: false },
};
export default async function IntakePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const tenants = (
    await db.query(
      "SELECT t.id,t.slug FROM tenants t JOIN memberships m ON m.team_id=t.team_id WHERE m.user_id=$1 AND t.status='running' AND t.desired_state='running' AND (SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' ELSE status END FROM effective_subscriptions WHERE team_id=t.team_id) IN ('trialing','active') ORDER BY t.slug",
      [session.user.id],
    )
  ).rows;
  const subscription = (
    await db.query(
      "SELECT s.*,n.desired_state,n.status AS tenant_status FROM teams t JOIN effective_subscriptions s ON s.team_id=t.id LEFT JOIN tenants n ON n.team_id=t.id WHERE t.owner_user_id=$1",
      [session.user.id],
    )
  ).rows[0];
  return (
    <section className="py-10">
      <Link href="/app" className="text-sm underline">
        ← Your workspace
      </Link>
      <BillingNotice subscription={subscription || null} compact />
      <p className="eyebrow mt-8">DOCUMENT INTAKE · BETA</p>
      <h1 className="text-4xl">Turn documents into shared knowledge.</h1>
      <p className="mt-4 max-w-2xl text-slate-600">
        Upload a document, review the AI suggestion, then publish it to
        BookStack. You stay in control of what your team reads.
      </p>
      {tenants.length ? (
        <Intake tenants={tenants} />
      ) : (
        <p className="price-card mt-8">
          You need a running BookStack workspace to use document intake.
        </p>
      )}
    </section>
  );
}
