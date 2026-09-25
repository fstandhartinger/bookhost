import { auth } from "@/auth";
import {
  boundedBody,
  clientFor,
  errorResponse,
  IntakeError,
  workspace,
} from "@/lib/intake/access";
import { db } from "@/lib/db";
import {
  embeddingsTenantIds,
  semanticEnabled,
} from "@/lib/chat/embeddings";
import { startWikiIndexBackfill } from "@/lib/chat/indexing";

function killSwitchOn() {
  return process.env.WIKI_EMBEDDINGS === "1";
}

function sourceFor(teamId: string, enabled: boolean) {
  if (!enabled) return "off";
  return embeddingsTenantIds().includes(teamId) ? "operator" : "workspace";
}

function statePayload(teamId: string, enabled: boolean, chunks: number) {
  return {
    enabled,
    source: sourceFor(teamId, enabled),
    killSwitch: killSwitchOn(),
    chunks,
  };
}

async function chunkCount(teamId: string) {
  const result = await db
    .query(
      "SELECT count(*)::int AS count FROM wiki_chunks WHERE team_id=$1",
      [teamId],
    )
    .catch(() => null);
  return Number(result?.rows[0]?.count ?? 0);
}

async function requireWorkspaceOwner(userId: string, tenantId: string) {
  const tenant = await workspace(userId, tenantId);
  // The workspace API token reads every page, so this setting is limited to
  // the people who can already read every page.
  if (!["owner", "admin"].includes(tenant.role))
    throw new IntakeError(
      "Only workspace owners and admins can change this setting.",
      403,
    );
  return tenant;
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      throw new IntakeError("Sign in to manage your workspace.", 401);
    const tenantId = new URL(request.url).searchParams.get("tenantId") ?? "";
    const tenant = await requireWorkspaceOwner(session.user.id, tenantId);
    const enabled = await semanticEnabled(tenant.team_id);
    return Response.json(
      statePayload(tenant.team_id, enabled, await chunkCount(tenant.team_id)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      throw new IntakeError("Sign in to manage your workspace.", 401);
    const body = await (await boundedBody(request, 16384))
      .json()
      .catch(() => {
        throw new IntakeError("The request could not be read.");
      });
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId : "";
    const enabled = body?.enabled;
    if (enabled !== true && enabled !== false)
      throw new IntakeError(
        "Choose whether to turn matching by meaning on or off.",
      );
    const tenant = await requireWorkspaceOwner(session.user.id, tenantId);
    if (enabled) {
      // The operator setting wins: an allowlisted team is not customer-
      // controlled, and a deployment without the switch offers no opt-in.
      if (embeddingsTenantIds().includes(tenant.team_id))
        throw new IntakeError(
          "Matching by meaning is managed by the operator for this workspace.",
          409,
        );
      if (!killSwitchOn())
        throw new IntakeError(
          "Matching by meaning is not available in this deployment.",
          409,
        );
      if (body.confirmNoPersonalData !== true)
        throw new IntakeError(
          "Confirm that the workspace contains no personal data first.",
        );
      await db.query(
        "UPDATE teams SET wiki_semantic_opt_in_at=now() WHERE id=$1",
        [tenant.team_id],
      );
      // Fire-and-forget like the chat route: the answer path proceeds
      // lexically while the vector index backfills in the background.
      const client = await clientFor(tenant);
      startWikiIndexBackfill(client, tenant.team_id);
    } else {
      await db.query(
        "UPDATE teams SET wiki_semantic_opt_in_at=NULL WHERE id=$1",
        [tenant.team_id],
      );
      await db.query("DELETE FROM wiki_chunks WHERE team_id=$1", [
        tenant.team_id,
      ]);
    }
    return Response.json(
      statePayload(tenant.team_id, enabled, await chunkCount(tenant.team_id)),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
