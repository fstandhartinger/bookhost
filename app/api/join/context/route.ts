import { baseUrl } from "@/lib/config";
import { NextResponse } from "next/server";
import { sameOriginForm, clientIp, digest, rateLimit } from "@/lib/security";
import { getInvite, inviteProblem } from "@/lib/team";
import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
import { JOIN_COOKIE, contextCookieOptions } from "@/lib/join-context";
export async function POST(request: Request) {
  if (!sameOriginForm(request))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  try {
    const ip = clientIp(request);
    if (!ip) throw new IntakeError("Missing client IP");
    if (!(await rateLimit("join-context:" + digest(ip), 60, 900)))
      throw new IntakeError("Please try again in 15 minutes.", 429);
    const form = request.headers
      .get("content-type")
      ?.includes("application/x-www-form-urlencoded");
    const body = await boundedBody(request, 8192);
    const data = form
      ? Object.fromEntries(await body.formData())
      : await body.json();
    const token = typeof data?.token === "string" ? data.token.trim() : "";
    const problem = inviteProblem(await getInvite(token));
    if (problem) throw new IntakeError(problem, 410);
    const response = form
      ? NextResponse.redirect(new URL("/join", baseUrl()), 303)
      : NextResponse.json({ url: "/join" });
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(JOIN_COOKIE, token, {
      ...contextCookieOptions(),
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
