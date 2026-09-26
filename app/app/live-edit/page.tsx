import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { activeTeamId, MEMBERSHIP_ORDER } from "@/lib/active-team";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { LiveEditPanel } from "@/components/live-edit-panel";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Live Edit",
  robots: { index: false, follow: false },
};
export default async function LiveEditSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { team: selectedTeam } = (await searchParams) || {};
  const activeId = await activeTeamId(session.user.id, selectedTeam);
  const memberships = (
    await db.query(
      `SELECT m.team_id,m.role FROM memberships m WHERE m.user_id=$1 ${MEMBERSHIP_ORDER}`,
      [session.user.id],
    )
  ).rows;
  const membership =
    memberships.find((m) => m.team_id === activeId) || memberships[0];
  const tenants = membership
    ? (
        await db.query(
          "SELECT t.id,t.team_id,t.slug FROM tenants t WHERE t.team_id=$1 AND t.status='running' AND t.desired_state='running' AND (SELECT CASE WHEN status='trialing' THEN trial_end>now() ELSE status='active' END FROM effective_subscriptions s WHERE s.team_id=t.team_id)",
          [membership.team_id],
        )
      ).rows
    : [];
  const role = membership?.role || "member";
  const canManage = ["owner", "admin"].includes(role);
  return (
    <section className="py-10">
      <Link href="/app" className="text-sm underline">
        ← Your workspace
      </Link>
      <p className="eyebrow mt-8">LIVE EDIT · BETA</p>
      <h1 className="text-4xl">Real-time collaborative editing.</h1>
      <p className="mt-4 max-w-2xl text-slate-600">
        Open a page in BookStack and edit it together, live, with your team
        — cursors, presence and all. Off by default; turn it on below.
      </p>
      {!tenants.length ? (
        <p className="price-card mt-8">
          You need a running BookStack workspace to use Live Edit.
        </p>
      ) : !canManage ? (
        <p className="price-card mt-8">
          Workspace owners and admins turn Live Edit on or off. Ask one of
          them if you want to use it.
        </p>
      ) : (
        <LiveEditPanel tenants={tenants} />
      )}
    </section>
  );
}
