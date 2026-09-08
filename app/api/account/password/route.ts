import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { auth, sessionCookie } from "@/auth";
import { changePassword, validNewPassword } from "@/lib/password";
import { sameOrigin, rateLimit } from "@/lib/security";
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!(await rateLimit("password-change:" + session.user.id, 10, 900)))
    return NextResponse.json(
      { error: "Try again in 15 minutes" },
      { status: 429 },
    );
  const data = await request.json().catch(() => ({}));
  if (
    typeof data.password !== "string" ||
    !validNewPassword(data.password, data.confirmation)
  )
    return NextResponse.json(
      { error: "Use 10–1024 characters and matching passwords" },
      { status: 400 },
    );
  const user = await changePassword(
    session.user.id,
    data.password,
    String(data.oldPassword || "").slice(0, 1024),
  );
  if (!user)
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 400 },
    );
  const cookie = sessionCookie();
  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      session_version: user.session_version,
    },
    secret: process.env.AUTH_SECRET!,
    salt: cookie.name,
    maxAge: 30 * 86400,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(cookie.name, token, {
    ...cookie.options,
    maxAge: 30 * 86400,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
