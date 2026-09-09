import { auth } from "@/auth";
import { db, transaction } from "@/lib/db";
import { billingEligible } from "@/lib/trial";
import { onboarding } from "@/lib/onboarding";
import { TENANT_DOMAIN } from "@/lib/config";
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.redirect(new URL("/login", request.url));
  const teamId = new URL(request.url).searchParams.get("team");
  if (
    !teamId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      teamId,
    )
  )
    return new Response("Not found", { status: 404 });
  const {
    rows: [tenant],
  } = await db.query(
    `SELECT n.slug,n.status,n.desired_state FROM tenants n
    JOIN memberships m ON m.team_id=n.team_id WHERE n.team_id=$1 AND m.user_id=$2`,
    [teamId, session.user.id],
  );
  const {
    rows: [subscription],
  } = await db.query("SELECT * FROM effective_subscriptions WHERE team_id=$1", [
    teamId,
  ]);
  if (
    !tenant ||
    tenant.status !== "running" ||
    tenant.desired_state === "suspended" ||
    !billingEligible(subscription)
  )
    return new Response("Workspace unavailable", { status: 403 });
  await transaction(async (c) => {
    await c.query(
      "UPDATE teams SET bookstack_opened_at=COALESCE(bookstack_opened_at,now()) WHERE id=$1",
      [teamId],
    );
    await c.query(
      `INSERT INTO events(name,team_id,utm_source) SELECT 'bookstack_opened',id,utm_source FROM teams WHERE id=$1 AND NOT analytics_opt_out`,
      [teamId],
    );
  });
  await onboarding(teamId);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://${tenant.slug}.${TENANT_DOMAIN}`,
      "Cache-Control": "no-store",
    },
  });
}
