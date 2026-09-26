import { auth } from "@/auth";
import { sameOrigin } from "@/lib/security";
import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
import {
  liveEditSettings,
  managedWorkspace,
  setLiveEditEnabled,
} from "@/lib/live-edit/settings";

export const dynamic = "force-dynamic";

async function userId() {
  const session = await auth();
  if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const user = await userId();
    const tenant = new URL(request.url).searchParams.get("tenant") || "";
    const ws = await managedWorkspace(user, tenant);
    return Response.json(await liveEditSettings(ws.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new IntakeError("Invalid origin.", 403);
    const user = await userId();
    let body;
    try {
      body = await (await boundedBody(request, 1024)).json();
    } catch (error) {
      if (error instanceof IntakeError) throw error;
      throw new IntakeError("Invalid request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new IntakeError("Invalid request.");
    const tenant = typeof body.tenant === "string" ? body.tenant : "";
    return Response.json(
      await setLiveEditEnabled(user, tenant, body.enabled),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
