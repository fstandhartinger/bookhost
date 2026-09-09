import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sameOrigin, rateLimit } from "@/lib/security";
import {
  clientFor,
  errorResponse,
  IntakeError,
  workspace,
} from "@/lib/intake/access";
import { streamUpload } from "@/lib/intake/upload";
import { acquireSlot } from "@/lib/intake/slots";
import { quota } from "@/lib/intake/quota";
import { enqueue } from "@/lib/intake/jobs";
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
        "SELECT id,filename,source,status,draft_title,error,created_at FROM intake_items WHERE team_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 50",
        [tenant.team_id, tenant.id],
      )
    ).rows;
    let books: import("@/lib/intake/bookstack").Destination[] = [],
      chapters: import("@/lib/intake/bookstack").Destination[] = [],
      destination_error = null;
    try {
      const client = await clientFor(tenant);
      books = await client.list("books");
      chapters = await client.list("chapters");
    } catch (error) {
      destination_error =
        error instanceof IntakeError
          ? error.message
          : "Tenant not reachable. Try again shortly.";
    }
    const allowance = await quota(tenant.team_id, tenant.subscription_status);
    return Response.json(
      {
        items,
        books,
        chapters,
        destination_error,
        quota: allowance,
        role: tenant.role,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  let release: (() => void) | null = null;
  let upload: Awaited<ReturnType<typeof streamUpload>> | null = null;
  try {
    if (!sameOrigin(request)) throw new IntakeError("Invalid origin.", 403);
    const session = await auth();
    if (!session?.user?.id) throw new IntakeError("Please sign in.", 401);
    const user = session.user.id;
    const tenant = await workspace(
      user,
      new URL(request.url).searchParams.get("tenant") || "",
    );
    release = acquireSlot();
    if (!release)
      throw new IntakeError(
        "Two documents are already processing. Try again shortly.",
        429,
      );
    if (
      !(await rateLimit(`intake-user:${user}`, 30)) ||
      !(await rateLimit(`intake-team:${tenant.team_id}`, 60))
    )
      throw new IntakeError("Upload limit reached. Try again in an hour.", 429);
    // Reject exhausted budgets before accepting a document body.
    if (!(await quota(tenant.team_id, tenant.subscription_status)).remaining)
      throw new IntakeError(
        "Draft allowance exhausted. Open the billing portal from Your workspace.",
        402,
      );
    upload = await streamUpload(request);
    const client = await clientFor(tenant);
    const current = await workspace(user, tenant.id);
    const target = await client.uploadTarget(upload.fields, upload.filename);
    await quota(tenant.team_id, current.subscription_status, true);
    const book = target.book.id;
    const chapter = target.chapter?.id || null;
    const item = (
      await db.query(
        "INSERT INTO intake_items(team_id,tenant_id,filename,mime,extracted_text,target_book_id,target_chapter_id,created_by,status,target_book_name,target_chapter_name) VALUES($1,$2,$3,'application/octet-stream',NULL,$4,$5,$6,'queued',$7,$8) RETURNING id",
        [
          tenant.team_id,
          tenant.id,
          upload.filename.slice(0, 255),
          book,
          chapter,
          user,
          target.book.name,
          target.chapter?.name || null,
        ],
      )
    ).rows[0];
    enqueue(
      item.id,
      user,
      tenant.id,
      upload.path,
      upload.filename,
      upload.cleanup,
      release,
    );
    upload = null;
    release = null;
    return Response.json({ id: item.id, status: "queued" }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (upload) await upload.cleanup();
    release?.();
  }
}
