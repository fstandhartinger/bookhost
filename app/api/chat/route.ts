import { auth } from "@/auth";
import {
  boundedBody,
  clientFor,
  errorResponse,
  IntakeError,
  workspace,
} from "@/lib/intake/access";
import { db } from "@/lib/db";
import { chatQuota, refundChat } from "@/lib/chat/quota";
import { aiEnabled, askWiki } from "@/lib/chat/ask";
import { embeddingsEnabledForTenant } from "@/lib/chat/embeddings";
import { startWikiIndexBackfill } from "@/lib/chat/indexing";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      throw new IntakeError("Sign in to ask your wiki.", 401);
    const body = await (await boundedBody(request, 16384))
      .json()
      .catch(() => {
        throw new IntakeError("Enter a question.");
      });
    const tenantId = typeof body?.tenant === "string" ? body.tenant : "";
    const question =
      typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length < 3 || question.length > 500)
      throw new IntakeError("Enter a question between 3 and 500 characters.");
    const tenant = await workspace(session.user.id, tenantId);
    // The workspace API token reads every page, so this beta is limited to the
    // people who can already read every page. Member-scoped answers need the
    // requester's own BookStack permissions and are not available yet.
    if (!["owner", "admin"].includes(tenant.role))
      throw new IntakeError(
        "Only workspace owners and admins can ask the wiki in this beta.",
        403,
      );
    // Passage retrieval is free; only AI synthesis counts against the allowance.
    const quota = aiEnabled()
      ? await chatQuota(tenant.team_id, tenant.subscription_status, true)
      : null;
    try {
      const client = await clientFor(tenant);
      // A gated tenant without an index answers lexically now and backfills
      // the vector index in the background (R1.2).
      if (embeddingsEnabledForTenant(tenant.team_id)) {
        const index = await db
          .query(
            "SELECT count(*)::int AS count FROM wiki_chunks WHERE team_id=$1",
            [tenant.team_id],
          )
          .catch(() => null);
        if (!index || index.rows[0]?.count === 0)
          startWikiIndexBackfill(client, tenant.team_id);
      }
      const result = await askWiki(client, question, {
        teamId: tenant.team_id,
      });
      return Response.json({ ...result, quota });
    } catch (error) {
      if (quota) await refundChat(tenant.team_id, quota.period).catch(() => {});
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
