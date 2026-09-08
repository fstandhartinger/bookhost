import { clientIp } from "@/lib/security";
import { handlers } from "@/auth";
import { NextRequest } from "next/server";
export const GET = handlers.GET;
export async function POST(request: NextRequest) {
  if (!clientIp(request))
    return Response.json({ error: "Missing client IP" }, { status: 400 });
  const response = await handlers.POST(request);
  // Auth.js normally reports CredentialsSignin using a redirect (or JSON URL).
  // Preserve that response while exposing throttling as an actual HTTP 429.
  const location =
    response.headers.get("location") ||
    (
      await response
        .clone()
        .json()
        .catch(() => ({}))
    ).url;
  if (
    location &&
    new URL(location, request.url).searchParams.get("code") === "rate_limited"
  ) {
    response.headers.set("Retry-After", "900");
    return new Response(response.body, {
      status: 429,
      headers: response.headers,
    });
  }
  return response;
}
