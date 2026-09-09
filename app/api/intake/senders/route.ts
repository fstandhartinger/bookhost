import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  boundedBody,
  errorResponse,
  IntakeError,
  workspace,
} from "@/lib/intake/access";
import { EMAIL_DOMAIN, normalizePattern } from "@/lib/intake/email";
import { sameOrigin } from "@/lib/security";
async function context(request: Request) {
  const session = await auth();
  if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
  return {
    user: session.user.id,
    tenant: await workspace(
      session.user.id,
      new URL(request.url).searchParams.get("tenant") || "",
    ),
  };
}
export async function GET(request: Request) {
  try {
    const { tenant } = await context(request);
    const senders = (
      await db.query(
        "SELECT id,pattern FROM intake_senders WHERE team_id=$1 ORDER BY pattern",
        [tenant.team_id],
      )
    ).rows;
    const members = (
      await db.query(
        "SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.email",
        [tenant.team_id],
      )
    ).rows.map((r) => r.email);
    const rejected = Number(
      (
        await db.query(
          "SELECT count(*) FROM events WHERE name='inbound_rejected' AND team_id=$1",
          [tenant.team_id],
        )
      ).rows[0].count,
    );
    return Response.json(
      {
        address: `${tenant.slug}@${EMAIL_DOMAIN}`,
        enabled: process.env.INBOUND_EMAIL_ENABLED === "true",
        can_manage: ["owner", "admin"].includes(tenant.role),
        senders,
        members,
        rejected,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new IntakeError("Invalid origin.", 403);
    const { user, tenant } = await context(request);
    if (!["owner", "admin"].includes(tenant.role))
      throw new IntakeError("Only owners and admins can manage senders.", 403);
    const body = await (await boundedBody(request, 4096)).json();
    if (
      typeof body.pattern !== "string" ||
      !["add", "remove"].includes(body.action)
    )
      throw new IntakeError("Invalid sender rule.");
    const pattern = normalizePattern(body.pattern);
    if (body.action === "remove")
      await db.query(
        "DELETE FROM intake_senders WHERE team_id=$1 AND pattern=$2",
        [tenant.team_id, pattern],
      );
    else
      await db.query(
        "INSERT INTO intake_senders(team_id,pattern,added_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [tenant.team_id, pattern, user],
      );
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
