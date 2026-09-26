import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { activeTeamId, MEMBERSHIP_ORDER } from "@/lib/active-team";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AgentsPanel } from "@/components/agents-panel";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Agents",
  robots: { index: false, follow: false },
};
export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Same team selection as the dashboard, so a link that names a team cannot
  // leave the two pages on different teams.
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
      <p className="eyebrow mt-8">AGENTS · BETA</p>
      <h1 className="text-4xl">
        Let AI agents work in your wiki — with you in control.
      </h1>
      <p className="mt-4 max-w-2xl text-slate-600">
        AI agents such as Claude Code, Cursor or Codex connect to your workspace
        over MCP. Each agent gets its own BookStack user with the role you
        choose, so BookStack permissions decide what it can read and change. By
        default its edits wait in the review queue until you approve them.
      </p>
      <p className="mt-3 max-w-2xl text-sm text-slate-500">
        Page content goes only to the agent you connect. BookHost itself does
        not send your pages to any AI for this feature.
      </p>
      {!tenants.length ? (
        <p className="price-card mt-8">
          You need a running BookStack workspace to connect agents.
        </p>
      ) : !canManage ? (
        <p className="price-card mt-8">
          Workspace owners and admins manage agent access: they create agent
          tokens, choose what agents may change and review their proposals. Ask
          one of them if you want to connect an agent.
        </p>
      ) : (
        <AgentsPanel tenants={tenants} />
      )}
    </section>
  );
}
