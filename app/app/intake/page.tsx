import { BillingNotice } from "@/components/billing-notice";
import React from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { ACTIVE_TEAM_COOKIE } from "@/lib/join-context";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Intake } from "@/components/intake";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Document intake",
  robots: { index: false, follow: false },
};
export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Follow the team the dashboard shows; never fall back to another team's
  // workspace. Same precedence and tie-break as the dashboard, so a link that
  // names a team cannot leave the two pages on different teams.
  const { team: selectedTeam } = (await searchParams) || {};
  const activeTeam = (await cookies()).get(ACTIVE_TEAM_COOKIE)?.value;
  const memberships = (
    await db.query(
      "SELECT m.team_id,m.role FROM memberships m WHERE m.user_id=$1 ORDER BY m.created_at DESC,m.team_id",
      [session.user.id],
    )
  ).rows;
  const membership =
    memberships.find((m) => m.team_id === (selectedTeam || activeTeam)) ||
    memberships[0];
  const tenants = membership
    ? (
        await db.query(
          "SELECT t.id,t.team_id,t.slug FROM tenants t WHERE t.team_id=$1 AND t.status='running' AND t.desired_state='running' AND (SELECT CASE WHEN status='trialing' THEN trial_end>now() ELSE status='active' END FROM effective_subscriptions s WHERE s.team_id=t.team_id)",
          [membership.team_id],
        )
      ).rows
    : [];
  const subscription = (
    await db.query(
      "SELECT s.*,n.desired_state,n.status AS tenant_status FROM effective_subscriptions s LEFT JOIN tenants n ON n.team_id=s.team_id WHERE s.team_id=$1",
      [membership?.team_id],
    )
  ).rows[0];
  const role = membership?.role || "member";
  return (
    <section className="py-10">
      <Link href="/app" className="text-sm underline">
        ← Your workspace
      </Link>
      <BillingNotice subscription={subscription || null} role={role} compact />
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
