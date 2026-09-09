import { transaction } from "@/lib/db";
import { memberRequest } from "@/lib/bookstack-member-request";
import { errorResponse, IntakeError } from "@/lib/intake/access";
export async function POST(request: Request) {
  try {
    const { teamId, userId } = await memberRequest(request);
    const password = await transaction(async (c) => {
      const member = (
        await c.query(
          "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 AND m.user_id=$2 FOR UPDATE OF m",
          [teamId, userId],
        )
      ).rows[0];
      if (!member || member.role === "owner")
        throw new IntakeError("Member login not found.", 404);
      const login = (
        await c.query(
          "SELECT l.initial_password FROM member_bookstack_logins l JOIN tenants t ON t.team_id=l.team_id WHERE l.team_id=$1 AND l.user_id=$2 AND t.status='running' AND t.desired_state='running' FOR UPDATE OF l",
          [teamId, userId],
        )
      ).rows[0];
      if (!login?.initial_password) return null;
      const value = login.initial_password as string;
      await c.query(
        "UPDATE member_bookstack_logins SET initial_password=NULL,updated_at=now() WHERE team_id=$1 AND user_id=$2",
        [teamId, userId],
      );
      return value;
    });
    return Response.json(
      password
        ? { password }
        : {
            error:
              "Password already viewed or workspace unavailable. Use password reset in your BookStack workspace.",
          },
      {
        status: password ? 200 : 410,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
