import { auth } from "@/auth";
import { errorResponse, IntakeError, workspace } from "@/lib/intake/access";
import { db } from "@/lib/db";
import { suggestedQuestions } from "@/lib/chat/suggestions";

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      throw new IntakeError("Sign in to ask your wiki.", 401);
    const tenantId =
      new URL(request.url).searchParams.get("tenant")?.trim() || "";
    const tenant = await workspace(session.user.id, tenantId);
    // Same beta gate as /api/chat: the workspace token reads every page.
    if (!["owner", "admin"].includes(tenant.role))
      throw new IntakeError(
        "Only workspace owners and admins can ask the wiki in this beta.",
        403,
      );
    try {
      const rows = (
        await db.query(
          "SELECT DISTINCT page_name, section FROM wiki_chunks WHERE team_id=$1 LIMIT 200",
          [tenant.team_id],
        )
      ).rows as { page_name: string; section: string | null }[];
      return Response.json({
        questions: suggestedQuestions(
          rows.map((row) => ({ pageName: row.page_name, section: row.section })),
        ),
      });
    } catch (error) {
      // UX sugar: never turn a lookup failure into a broken chat page.
      console.error("Suggested questions lookup failed", error);
      return Response.json({ questions: [] });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
