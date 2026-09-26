import { transaction } from "@/lib/db";
import { AgentError } from "./bookstack-user";
import type { AgentIdentity, AgentWorkspace } from "./access";
import { markdownToHtml } from "./markdown";

export const MAX_OPEN_PROPOSALS = 100;

export type ProposalKind = "create" | "update" | "append";
export type Proposal = {
  kind: ProposalKind;
  title: string;
  // Agent Markdown is kept as the source; draft_html is only a review preview.
  // On approval BookStack itself renders the Markdown (create/update) or the
  // preview HTML is appended to the page's current content (append).
  markdown: string | null;
  note: string;
  bookId: number;
  bookName: string;
  chapterId: number | null;
  chapterName: string | null;
  pageId?: number;
  pageName?: string;
  baseRevisionCount?: number;
  baseUpdatedAt?: string;
};

// Agent proposals reuse the reviewed document intake queue: they arrive as
// drafts that an owner/admin publishes or rejects. No AI drafting runs, so no
// intake draft quota is reserved.
export async function createProposal(
  workspace: AgentWorkspace,
  identity: AgentIdentity,
  fingerprint: string,
  proposal: Proposal,
) {
  if (!workspace.team_id)
    throw new AgentError("This workspace has no review queue.", "invalid");
  // Per-workspace lock keeps the open-proposal cap exact under concurrency.
  return transaction(async (c) => {
    await c.query("SELECT 1 FROM tenants WHERE id=$1 FOR UPDATE", [
      workspace.id,
    ]);
    const open = Number(
      (
        await c.query(
          "SELECT count(*) FROM intake_items WHERE tenant_id=$1 AND source='agent' AND status IN ('draft','failed','approved')",
          [workspace.id],
        )
      ).rows[0].count,
    );
    if (open >= MAX_OPEN_PROPOSALS)
      throw new AgentError(
        `The review queue already holds ${MAX_OPEN_PROPOSALS} open agent proposals. Ask a workspace owner to review them first.`,
        "rate_limited",
      );
    const row = (
      await c.query(
        `INSERT INTO intake_items(team_id,tenant_id,filename,mime,extracted_text,status,draft_title,draft_html,draft_tags,target_book_id,target_chapter_id,target_book_name,target_chapter_name,source,source_metadata)
       VALUES($1,$2,$3,'text/markdown',$4,'draft',$5,$6,'[]'::jsonb,$7,$8,$9,$10,'agent',$11) RETURNING id`,
        [
          workspace.team_id,
          workspace.id,
          `Agent proposal: ${proposal.title}`.slice(0, 255),
          proposal.markdown,
          proposal.title,
          proposal.markdown === null ? "" : markdownToHtml(proposal.markdown),
          proposal.bookId,
          proposal.chapterId,
          proposal.bookName,
          proposal.chapterName,
          JSON.stringify({
            kind: proposal.kind,
            agent_name: identity.label,
            agent_id: identity.agentId,
            token_fingerprint: fingerprint,
            page_id: proposal.pageId ?? null,
            page_name: proposal.pageName ?? null,
            base_revision_count: proposal.baseRevisionCount ?? null,
            base_updated_at: proposal.baseUpdatedAt ?? null,
            note: proposal.note.slice(0, 2000),
            proposed_at: new Date().toISOString(),
          }),
        ],
      )
    ).rows[0];
    return row.id as string;
  });
}
