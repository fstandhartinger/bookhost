import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sameOrigin } from "@/lib/security";
import {
  boundedBody,
  clientFor,
  errorResponse,
  IntakeError,
  itemForUser,
} from "@/lib/intake/access";
import { canPublish, canTransition, cleanHtml } from "@/lib/intake/content";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const item = await itemForUser(session.user.id, (await context.params).id);
    // Raw extracted source stays server-side; never return credentials.
    const {
      id,
      filename,
      status,
      draft_title,
      draft_html,
      draft_tags,
      error,
      bookstack_page_id,
      slug,
      role,
    } = item;
    return Response.json(
      {
        id,
        filename,
        status,
        draft_title,
        draft_html: cleanHtml(draft_html || ""),
        draft_tags,
        error,
        can_publish: canPublish(role),
        url: bookstack_page_id
          ? `https://${slug}.wissen.app.mintapis.com/link/${bookstack_page_id}`
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOrigin(request)) throw new IntakeError("Invalid origin.", 403);
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const item = await itemForUser(session.user.id, (await context.params).id);
    const body = await (await boundedBody(request, 150000)).json();
    if (!body || typeof body !== "object")
      throw new IntakeError("Invalid review.");
    if (body.action === "reject") {
      if (!canTransition(item.status, "rejected"))
        throw new IntakeError("This document cannot be rejected.", 409);
      const result = await db.query(
        "UPDATE intake_items SET status='rejected',updated_at=now() WHERE id=$1 AND status=$2 RETURNING id",
        [item.id, item.status],
      );
      if (!result.rowCount)
        throw new IntakeError("This document has changed. Refresh it.", 409);
      return Response.json({ ok: true });
    }
    if (body.action !== "publish")
      throw new IntakeError("Unknown review action.");
    if (!canPublish(item.role))
      throw new IntakeError("Only team owners and admins can publish.", 403);
    if (!canTransition(item.status, "approved"))
      throw new IntakeError("This document has already been reviewed.", 409);
    if (
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 250 ||
      typeof body.html !== "string" ||
      body.html.length > 120000
    )
      throw new IntakeError(
        "Enter a title (up to 250 characters) and page HTML.",
      );
    const html = cleanHtml(body.html);
    if (!html.replace(/<[^>]*>/g, "").trim())
      throw new IntakeError("Page content cannot be empty.");
    const client = await clientFor({ id: item.tenant_id, slug: item.slug });
    await client.validateTarget(item.target_book_id, item.target_chapter_id);
    // Durable compare-and-swap before network I/O prevents double publication.
    const claimed = await db.query(
      "UPDATE intake_items SET status='approved',draft_title=$2,draft_html=$3,updated_at=now() WHERE id=$1 AND status='draft' RETURNING id",
      [item.id, body.title.trim(), html],
    );
    if (!claimed.rowCount)
      throw new IntakeError("This document is already being published.", 409);
    try {
      const page = await client.publish(
        body.title.trim(),
        html,
        item.draft_tags,
        item.target_book_id,
        item.target_chapter_id,
      );
      if (!Number.isSafeInteger(page.id) || page.id < 1)
        throw new Error("Invalid page response");
      await db.query(
        "UPDATE intake_items SET status='published',bookstack_page_id=$2,error=NULL,updated_at=now() WHERE id=$1 AND status='approved'",
        [item.id, page.id],
      );
      return Response.json({ url: `${client.base}/link/${page.id}` });
    } catch {
      await db.query(
        "UPDATE intake_items SET status='failed',error='Publication could not be confirmed. Check BookStack before uploading again to avoid duplicate pages; contact support if needed.',updated_at=now() WHERE id=$1 AND status='approved'",
        [item.id],
      );
      throw new IntakeError(
        "Publication could not be confirmed. Check BookStack before uploading again.",
        502,
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
