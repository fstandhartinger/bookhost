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
import { TENANT_DOMAIN } from "@/lib/config";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const item = await itemForUser(session.user.id, (await context.params).id);
    // Source preview is visible only through the item membership check.
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
        target_book_id: item.target_book_id,
        target_chapter_id: item.target_chapter_id,
        target_book_name: item.target_book_name,
        target_chapter_name: item.target_chapter_name,
        source: item.source,
        source_metadata: item.source_metadata,
        source_preview: (item.extracted_text || "").slice(0, 2000),
        can_publish: canPublish(role),
        url: bookstack_page_id
          ? `https://${slug}.${TENANT_DOMAIN}/link/${bookstack_page_id}`
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
        "UPDATE intake_items SET status='rejected',extracted_text=NULL,updated_at=now() WHERE id=$1 AND status=$2 RETURNING id",
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
    if (item.status === "published")
      return Response.json({
        url: `https://${item.slug}.${TENANT_DOMAIN}/link/${item.bookstack_page_id}`,
      });
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
    const tags = body.tags === undefined ? item.draft_tags : body.tags;
    if (
      !Array.isArray(tags) ||
      tags.length < 3 ||
      tags.length > 6 ||
      tags.some((t) => typeof t !== "string" || !t.trim() || t.length > 60)
    )
      throw new IntakeError("Enter 3–6 tags, each up to 60 characters.");
    const html = cleanHtml(body.html);
    if (!html.replace(/<[^>]*>/g, "").trim())
      throw new IntakeError("Page content cannot be empty.");
    const client = await clientFor({ id: item.tenant_id, slug: item.slug });
    const bookId =
      body.book_id === undefined ? item.target_book_id : Number(body.book_id);
    const chapterId =
      body.chapter_id === undefined
        ? item.target_chapter_id
        : body.chapter_id
          ? Number(body.chapter_id)
          : null;
    if (
      !Number.isSafeInteger(bookId) ||
      bookId < 1 ||
      (chapterId !== null &&
        (!Number.isSafeInteger(chapterId) || chapterId < 1))
    )
      throw new IntakeError("Choose a destination book and optional chapter.");
    const target = await client.validateTarget(bookId, chapterId);
    // Durable compare-and-swap before network I/O prevents double publication.
    const claimed = await db.query(
      `UPDATE intake_items i SET status='approved',draft_title=$2,draft_html=$3,draft_tags=$9,target_book_id=$5,target_chapter_id=$6,target_book_name=$7,target_chapter_name=$8,updated_at=now()
       WHERE i.id=$1 AND i.status IN ('draft','failed') AND EXISTS(SELECT 1 FROM tenants t JOIN memberships m ON m.team_id=t.team_id WHERE t.id=i.tenant_id AND t.status='running' AND t.desired_state='running' AND m.user_id=$4 AND m.role IN ('owner','admin') AND (SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' ELSE status END FROM effective_subscriptions WHERE team_id=t.team_id) IN ('trialing','active')) RETURNING id`,
      [
        item.id,
        body.title.trim(),
        html,
        session.user.id,
        bookId,
        chapterId,
        target.book.name,
        target.chapter?.name || null,
        JSON.stringify(tags),
      ],
    );
    if (!claimed.rowCount)
      throw new IntakeError("This document is already being published.", 409);
    try {
      const page = await client.publish(
        body.title.trim(),
        html,
        tags,
        bookId,
        chapterId,
        item.id,
      );
      if (!Number.isSafeInteger(page.id) || page.id < 1)
        throw new Error("Invalid page response");
      await db.query(
        "UPDATE intake_items SET status='published',extracted_text=NULL,bookstack_page_id=$2,error=NULL,updated_at=now() WHERE id=$1 AND status='approved'",
        [item.id, page.id],
      );
      return Response.json({ url: `${client.base}/link/${page.id}` });
    } catch (error) {
      await db.query(
        "UPDATE intake_items SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='approved'",
        [
          item.id,
          error instanceof IntakeError
            ? error.message
            : "Publication could not be confirmed. Retry this draft; existing pages are reconciled before creating a page.",
        ],
      );
      if (error instanceof IntakeError) throw error;
      throw new IntakeError(
        "Publication could not be confirmed. Check BookStack before uploading again.",
        502,
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
