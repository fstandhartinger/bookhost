import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { activeTeamId, MEMBERSHIP_ORDER } from "@/lib/active-team";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { WikiChat } from "@/components/wiki-chat";
import { CHAT_COPY } from "@/lib/quotas";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ask your wiki",
  robots: { index: false, follow: false },
};
export default async function ChatPage({
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
  const canAsk = ["owner", "admin"].includes(role);
  return (
    <section className="py-10">
      <Link href="/app" className="text-sm underline">
        ← Your workspace
      </Link>
      <p className="eyebrow mt-8">ASK YOUR WIKI · BETA</p>
      <h1 className="text-4xl">Answers with their sources attached.</h1>
      <p className="mt-4 max-w-2xl text-slate-600">
        Ask a question in your own words. BookHost finds the matching pages in
        your workspace and shows the page and section behind each result, so no
        claim is unsourced. AI-written summaries follow once the provider
        documents are complete.
      </p>
      <p className="mt-3 max-w-2xl text-sm text-slate-500">{CHAT_COPY}</p>
      {!tenants.length ? (
        <p className="price-card mt-8">
          You need a running BookStack workspace to ask your wiki.
        </p>
      ) : !canAsk ? (
        <p className="price-card mt-8">
          This beta is open to workspace owners and admins, because the
          workspace API token reads every page. Answers scoped to each
          member&rsquo;s own BookStack permissions are planned.
        </p>
      ) : (
        <WikiChat tenants={tenants} />
      )}
    </section>
  );
}
