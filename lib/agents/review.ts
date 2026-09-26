import { db } from "@/lib/db";
import { tenantHost } from "@/lib/tenant-host";
import { clientFor, IntakeError } from "@/lib/intake/access";
import { canPublish, canTransition } from "@/lib/intake/content";

type Item = {
  id: string;
  tenant_id: string;
  slug: string;
  host: string | null;
  role: string;
  status: Parameters<typeof canTransition>[0];
  draft_title: string | null;
  draft_html: string | null;
  extracted_text: string | null;
  target_book_id: number;
  target_chapter_id: number | null;
  bookstack_page_id: number | null;
  source_metadata: {
    kind?: "create" | "update" | "append";
    page_id?: number | null;
    base_revision_count?: number | null;
    apply_revision?: number | null;
  };
};

type Page = {
  id: number;
  name: string;
  revision_count: number;
  editor?: string;
  html?: string;
  markdown?: string;
};

// Approving an agent proposal applies exactly what the agent submitted; the
// reviewer can approve or reject but not silently rewrite it. The change is
// written by BookHost's intake service user in BookStack, on the reviewer's
// approval, like any other reviewed intake draft.
export async function publishAgentProposal(item: Item, userId: string) {
  if (!canPublish(item.role))
    throw new IntakeError(
      "Only team owners and admins can approve agent proposals.",
      403,
    );
  const host = tenantHost(item);
  if (item.status === "published")
    return { url: `https://${host}/link/${item.bookstack_page_id}` };
  if (!canTransition(item.status, "approved"))
    throw new IntakeError("This proposal has already been reviewed.", 409);
  const meta = item.source_metadata || {};
  const kind = meta.kind;
  if (!kind || !["create", "update", "append"].includes(kind))
    throw new IntakeError("This proposal is incomplete. Reject it.", 409);
  const client = await clientFor({ id: item.tenant_id, slug: item.slug, host });
  const claimed = await db.query(
    `UPDATE intake_items i SET status='approved',updated_at=now()
     WHERE i.id=$1 AND i.status IN ('draft','failed') AND EXISTS(SELECT 1 FROM tenants t JOIN memberships m ON m.team_id=t.team_id WHERE t.id=i.tenant_id AND t.status='running' AND t.desired_state='running' AND m.user_id=$2 AND m.role IN ('owner','admin') AND (SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' WHEN status IN ('past_due','unpaid') AND payment_grace_until<=now() AND payment_failure_notified_at<now() THEN 'expired' ELSE status END FROM effective_subscriptions WHERE team_id=t.team_id) IN ('trialing','active','past_due','unpaid')) RETURNING id`,
    [item.id, userId],
  );
  if (!claimed.rowCount)
    throw new IntakeError("This proposal is already being applied.", 409);
  const fail = async (message: string) => {
    await db.query(
      "UPDATE intake_items SET status='failed',error=$2,updated_at=now() WHERE id=$1 AND status='approved'",
      [item.id, message],
    );
  };
  try {
    let pageId: number;
    if (kind === "create") {
      const existing = await client.findPublished(item.id);
      pageId = existing
        ? existing.id
        : (
            await client.request<{ id: number }>("pages", {
              name: item.draft_title,
              markdown: item.extracted_text || "",
              tags: [{ name: "wissen-intake", value: item.id }],
              ...(item.target_chapter_id
                ? { chapter_id: item.target_chapter_id }
                : { book_id: item.target_book_id }),
            })
          ).id;
    } else {
      pageId = Number(meta.page_id);
      if (!Number.isSafeInteger(pageId) || pageId < 1)
        throw new IntakeError("This proposal is incomplete. Reject it.", 409);
      const page = await client.request<Page>(`pages/${pageId}`);
      // A retry after an uncertain write must not apply the change twice.
      if (
        typeof meta.apply_revision === "number" &&
        page.revision_count !== meta.apply_revision
      )
        throw new IntakeError(
          "The page changed after the first attempt to apply this proposal, so it may already be applied. Check the page in BookStack and reject this proposal if the change is there.",
          409,
        );
      if (
        kind === "update" &&
        typeof meta.base_revision_count === "number" &&
        page.revision_count !== meta.base_revision_count
      ) {
        throw new IntakeError(
          `The page was edited after the agent proposed this change (revision ${meta.base_revision_count} → ${page.revision_count}). Reject this proposal and ask the agent to propose again from the current page.`,
          409,
        );
      }
      const body =
        kind === "append"
          ? page.editor === "markdown" && typeof page.markdown === "string"
            ? {
                markdown: `${page.markdown.replace(/\s+$/, "")}\n\n${item.extracted_text || ""}`,
              }
            : { html: `${page.html || ""}\n${item.draft_html || ""}` }
          : {
              ...(item.draft_title && item.draft_title !== page.name
                ? { name: item.draft_title }
                : {}),
              ...(item.extracted_text !== null
                ? { markdown: item.extracted_text }
                : {}),
            };
      if (Object.keys(body).length) {
        await db.query(
          "UPDATE intake_items SET source_metadata=source_metadata||jsonb_build_object('apply_revision',$2::int) WHERE id=$1",
          [item.id, page.revision_count],
        );
        await client.request(`pages/${pageId}`, body, "PUT");
      }
    }
    if (!Number.isSafeInteger(pageId) || pageId < 1)
      throw new Error("Invalid page response");
    await db.query(
      "UPDATE intake_items SET status='published',extracted_text=NULL,bookstack_page_id=$2,error=NULL,updated_at=now() WHERE id=$1 AND status='approved'",
      [item.id, pageId],
    );
    return { url: `${client.base}/link/${pageId}` };
  } catch (error) {
    await fail(
      error instanceof IntakeError
        ? error.message
        : "Applying the proposal could not be confirmed. Check the page in BookStack before retrying.",
    );
    if (error instanceof IntakeError) throw error;
    throw new IntakeError(
      "Applying the proposal could not be confirmed. Check the page in BookStack before retrying.",
      502,
    );
  }
}
