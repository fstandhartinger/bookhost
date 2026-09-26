import { auth } from "@/auth";
import { sameOrigin } from "@/lib/security";
import { boundedBody, errorResponse, IntakeError } from "@/lib/intake/access";
import {
  createAgent,
  overview,
  revokeAgent,
  setAccess,
  setWriteMode,
} from "@/lib/agents/manage";

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
    return Response.json(await overview(user, tenant), {
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
      body = await (await boundedBody(request, 4096)).json();
    } catch (error) {
      if (error instanceof IntakeError) throw error;
      throw new IntakeError("Invalid request.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new IntakeError("Invalid request.");
    const tenant = typeof body.tenant === "string" ? body.tenant : "";
    const headers = { "Cache-Control": "no-store" };
    switch (body.action) {
      case "set_mode":
        return Response.json(await setWriteMode(user, tenant, body.mode), {
          headers,
        });
      case "set_access":
        return Response.json(await setAccess(user, tenant, body.enabled), {
          headers,
        });
      case "create_agent":
        return Response.json(
          await createAgent(user, tenant, {
            name: body.name,
            role_id: body.role_id,
          }),
          { status: 201, headers },
        );
      case "revoke_agent":
        return Response.json(await revokeAgent(user, tenant, body.agent_id), {
          headers,
        });
      default:
        throw new IntakeError("Unknown action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
