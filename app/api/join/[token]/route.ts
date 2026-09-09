import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth, sessionCookie } from "@/auth";
import { clientIp, digest, rateLimit, sameOrigin } from "@/lib/security";
import { joinTeam } from "@/lib/team";
import { boundedBody, errorResponse } from "@/lib/intake/access";
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  if (!sameOrigin(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const ip = clientIp(request);
  if (!ip)
    return Response.json({ error: "Missing client IP" }, { status: 400 });
  if (!(await rateLimit("join:" + digest(ip), 10, 900)))
    return Response.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  try {
    const session = await auth();
    const user = await joinTeam(
      (await context.params).token,
      session?.user?.id,
      await (await boundedBody(request, 8192)).json(),
    );
    const cookie = sessionCookie();
    const token = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
        session_version: user.session_version,
        auth_time: session?.user?.id
          ? session.auth_time
          : Math.floor(Date.now() / 1000),
      },
      secret: process.env.AUTH_SECRET!,
      salt: cookie.name,
      maxAge: 30 * 86400,
    });
    const response = NextResponse.json(
      { url: "/app" },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(cookie.name, token, {
      ...cookie.options,
      maxAge: 30 * 86400,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
