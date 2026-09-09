import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth, sessionCookie } from "@/auth";
import { clientIp, sameOrigin } from "@/lib/security";
import { joinTeam } from "@/lib/team";
import {
  consumePasswordAttempt,
  normalizeEmail,
  PasswordRateLimit,
} from "@/lib/password";
import {
  JOIN_COOKIE,
  ACTIVE_TEAM_COOKIE,
  contextCookieOptions,
} from "@/lib/join-context";
import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!clientIp(request))
    return Response.json({ error: "Missing client IP" }, { status: 400 });
  try {
    const session = await auth();
    const data = await (await boundedBody(request, 8192)).json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new IntakeError("Invalid details");
    if (!session?.user?.id)
      await consumePasswordAttempt(normalizeEmail(data.email), request);
    const invitation = (await cookies()).get(JOIN_COOKIE)?.value || "";
    const user = await joinTeam(
      invitation,
      session?.user?.id,
      data,
      session?.session_version,
    );
    const response = NextResponse.json(
      { url: `/app?team=${user.team_id}` },
      { headers: { "Cache-Control": "no-store" } },
    );
    // An authenticated join never replaces a session. A concurrent revocation
    // after the user lock is released must still invalidate the original JWT.
    if (!session?.user?.id) {
      const cookie = sessionCookie();
      const token = await encode({
        token: {
          sub: user.id,
          email: user.email,
          name: user.name,
          session_version: user.session_version,
          auth_time: Math.floor(Date.now() / 1000),
        },
        secret: process.env.AUTH_SECRET!,
        salt: cookie.name,
        maxAge: 30 * 86400,
      });
      response.cookies.set(cookie.name, token, {
        ...cookie.options,
        maxAge: 30 * 86400,
      });
    }
    response.cookies.set(ACTIVE_TEAM_COOKIE, user.team_id, {
      ...contextCookieOptions(),
      maxAge: 30 * 86400,
    });
    response.cookies.set(JOIN_COOKIE, "", {
      ...contextCookieOptions(),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    if (error instanceof PasswordRateLimit)
      return Response.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    return errorResponse(error);
  }
}
