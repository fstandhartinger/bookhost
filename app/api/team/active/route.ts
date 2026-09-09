import { baseUrl } from "@/lib/config";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sameOriginForm } from "@/lib/security";
import { boundedBody, errorResponse, uuid } from "@/lib/intake/access";
import { ACTIVE_TEAM_COOKIE, contextCookieOptions } from "@/lib/join-context";
export async function POST(request: Request) {
  if (!sameOriginForm(request)) return new Response(null, { status: 403 });
  const session = await auth();
  if (!session?.user?.id) return new Response(null, { status: 401 });
  try {
    const data = await (await boundedBody(request, 4096)).formData();
    const team = String(data.get("team") || "");
    if (
      !uuid(team) ||
      !(
        await db.query(
          "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2",
          [team, session.user.id],
        )
      ).rowCount
    )
      return new Response(null, { status: 404 });
    const response = NextResponse.redirect(new URL("/app", baseUrl()), 303);
    response.cookies.set(ACTIVE_TEAM_COOKIE, team, {
      ...contextCookieOptions(),
      maxAge: 30 * 86400,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
