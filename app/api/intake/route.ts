import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sameOrigin, rateLimit } from "@/lib/security";
import {
  boundedBody,
  clientFor,
  errorResponse,
  IntakeError,
  workspace,
} from "@/lib/intake/access";
import { extractText, MAX_FILE } from "@/lib/intake/content";
import { generateDraft } from "@/lib/intake/draft";
export const runtime = "nodejs";
export const maxDuration = 240;
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const tenant = await workspace(
      session.user.id,
      new URL(request.url).searchParams.get("tenant") || "",
    );
    const items = (
      await db.query(
        "SELECT id,filename,status,draft_title,error,created_at FROM intake_items WHERE team_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 50",
        [tenant.team_id, tenant.id],
      )
    ).rows;
    const client = await clientFor(tenant);
    const books = await client.list("books");
    const chapters = await client.list("chapters");
    return Response.json(
      { items, books, chapters, role: tenant.role },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new IntakeError("Invalid origin.", 403);
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const userId = session.user.id;
    if (!(await rateLimit(`intake-user:${userId}`, 30)))
      throw new IntakeError("Upload limit reached. Try again in an hour.", 429);
    const form = await (
      await boundedBody(request, MAX_FILE + 65536)
    ).formData();
    const tenant = await workspace(userId, String(form.get("tenant_id") || ""));
    if (!(await rateLimit(`intake-team:${tenant.team_id}`, 60)))
      throw new IntakeError(
        "Team upload limit reached. Try again in an hour.",
        429,
      );
    const file = form.get("file");
    if (!(file instanceof File)) throw new IntakeError("Choose a document.");
    const bookId = Number(form.get("book_id"));
    const chapterId = form.get("chapter_id")
      ? Number(form.get("chapter_id"))
      : null;
    if (
      !Number.isSafeInteger(bookId) ||
      bookId < 1 ||
      (chapterId !== null &&
        (!Number.isSafeInteger(chapterId) || chapterId < 1))
    )
      throw new IntakeError("Choose a destination book and optional chapter.");
    const client = await clientFor(tenant);
    await client.validateTarget(bookId, chapterId);
    let extracted;
    try {
      extracted = await extractText(
        file.name,
        Buffer.from(await file.arrayBuffer()),
      );
    } catch (error) {
      throw new IntakeError(
        error instanceof Error &&
          error.message.match(/^(Choose|Use |No readable|This document)/)
          ? error.message
          : "Could not read this file. Use an unencrypted PDF, DOCX or UTF-8 text file.",
      );
    }
    const item = (
      await db.query(
        "INSERT INTO intake_items(team_id,tenant_id,filename,mime,extracted_text,target_book_id,target_chapter_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [
          tenant.team_id,
          tenant.id,
          file.name.slice(0, 255),
          extracted.mime,
          extracted.text,
          bookId,
          chapterId,
          userId,
        ],
      )
    ).rows[0];
    await db.query(
      "UPDATE intake_items SET status='drafting',updated_at=now() WHERE id=$1 AND status='uploaded'",
      [item.id],
    );
    try {
      const draft = await generateDraft(extracted.text);
      await db.query(
        "UPDATE intake_items SET status='draft',draft_title=$2,draft_html=$3,draft_tags=$4,updated_at=now() WHERE id=$1 AND status='drafting'",
        [item.id, draft.title, draft.html, JSON.stringify(draft.tags)],
      );
    } catch {
      await db.query(
        "UPDATE intake_items SET status='failed',error='Could not create a draft. Wait a moment, then upload again.',updated_at=now() WHERE id=$1 AND status='drafting'",
        [item.id],
      );
    }
    return Response.json({ id: item.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
