import { Hocuspocus } from "@hocuspocus/server";
import { db } from "@/lib/db";
import { clientFor, IntakeError } from "@/lib/intake/access";
import { tenantHost } from "@/lib/tenant-host";
import { verifyJoinToken } from "./join-token";
import { seedYdocFromHtml, htmlFromYdoc } from "./tiptap-bridge";
import { presenceJoin, presenceLeave } from "./presence-store";
import { liveEditReady } from "./settings";

type LiveEditContext = {
  tenantId: string;
  tenantSlug: string;
  tenantHost: string;
  documentName: string;
  pageId: number;
  bookstackUserId: number;
  userName: string;
  canEdit: boolean;
};

async function tenantForSlug(slug: string) {
  const row = (
    await db.query(
      "SELECT id,slug,host FROM tenants WHERE slug=$1 AND status='running' AND desired_state='running'",
      [slug],
    )
  ).rows[0];
  if (!row) throw new IntakeError("Workspace not found.", 404);
  return row as { id: string; slug: string; host: string | null };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The revision_count BookHost last saw for a document, used as a best-effort
// optimistic-concurrency guard (same pattern already used for agent writes,
// see lib/agents/tools.ts's expected_revision_count — a client-side
// read-then-compare check, not an atomic BookStack API feature, since
// BookStack's API has none). Cleared in afterUnloadDocument.
const lastKnownRevision = new Map<string, number>();

let instance: Hocuspocus | null = null;

// The headless Hocuspocus class (hooks + handleConnection + document
// registry), not the `Server` export — that one spins up its own HTTP/WS
// listener via crossws, which would fight the custom server (server-src/main.ts)
// that already owns the process's single HTTP server so it can share it with
// Next. We call `.handleConnection()` ourselves from that custom server's
// `upgrade` handler instead.
export function hocuspocusServer(): Hocuspocus {
  if (instance) return instance;
  instance = new Hocuspocus({
    debounce: 5000,
    maxDebounce: 15000,
    quiet: true,

    async onAuthenticate(data) {
      const payload = verifyJoinToken(data.token);
      if (!payload) throw new Error("This Live Edit session expired. Reopen Live Edit.");
      if (payload.documentName !== data.documentName)
        throw new Error("Live Edit session does not match this page.");
      const tenant = await tenantForSlug(payload.tenant);
      if (!(await liveEditReady(tenant.id)))
        throw new Error("Live Edit is turned off for this workspace.");
      data.connectionConfig.readOnly = !payload.canEdit;
      presenceJoin(payload.documentName);
      db.query(
        "INSERT INTO live_edit_sessions(tenant_id,page_id,bookstack_user_id,can_edit) VALUES($1,$2,$3,$4)",
        [tenant.id, payload.pageId, payload.bookstackUserId, payload.canEdit],
      ).catch(() => {});
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantHost: tenantHost(tenant),
        documentName: payload.documentName,
        pageId: payload.pageId,
        bookstackUserId: payload.bookstackUserId,
        userName: payload.userName,
        canEdit: payload.canEdit,
      } satisfies LiveEditContext;
    },

    async onLoadDocument(data) {
      const ctx = data.context as LiveEditContext;
      const client = await clientFor({
        id: ctx.tenantId,
        slug: ctx.tenantSlug,
        host: ctx.tenantHost,
      });
      const page = await client.request<{ html: string; revision_count: number }>(
        `pages/${ctx.pageId}`,
      );
      lastKnownRevision.set(data.documentName, page.revision_count);
      return seedYdocFromHtml(page.html || "");
    },

    async onStoreDocument(data) {
      // This runs on a debounce timer shared by every tenant's document, not
      // tied to one connection's own promise chain — an uncaught rejection
      // here must never propagate out and take down live sessions for every
      // other workspace on this one shared server.
      try {
        const ctx = data.lastContext as LiveEditContext;
        if (!ctx?.tenantId) return;

        // Turning the beta off doesn't push-revoke already-open sockets on
        // its own; piggyback the check on this same periodic cycle (every
        // <=15s while dirty, or immediately on the final disconnect) so a
        // disabled workspace's live sessions wind down quickly without a
        // separate polling mechanism.
        if (!(await liveEditReady(ctx.tenantId))) {
          data.instance.closeConnections(data.documentName);
        }

        const client = await clientFor({
          id: ctx.tenantId,
          slug: ctx.tenantSlug,
          host: ctx.tenantHost,
        });

        // Best-effort optimistic-concurrency guard: if someone saved this
        // page outside Live Edit since we last saved it ourselves, don't
        // silently clobber that edit on a routine mid-session debounce —
        // only the final save (no connections left) goes through regardless,
        // so a live-edited change is never discarded outright; both ends up
        // as BookStack revisions, recoverable either way.
        const before = await client.request<{ revision_count: number }>(
          `pages/${ctx.pageId}`,
        );
        const expected = lastKnownRevision.get(data.documentName);
        if (
          expected !== undefined &&
          before.revision_count !== expected &&
          data.clientsCount > 0
        ) {
          console.warn(
            `[live-edit] skipping save for ${data.documentName}: page changed outside Live Edit (revision ${before.revision_count}, expected ${expected})`,
          );
          return;
        }

        const html = htmlFromYdoc(data.document);
        let saved: { revision_count: number } | undefined;
        let lastError: unknown;
        for (const delayMs of [0, 1000, 3000]) {
          if (delayMs) await sleep(delayMs);
          try {
            saved = await client.request<{ revision_count: number }>(
              `pages/${ctx.pageId}`,
              { html, changelog: "Live edit session" },
              "PUT",
            );
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;

        if (saved) lastKnownRevision.set(data.documentName, saved.revision_count);
        db.query(
          "UPDATE live_edit_sessions SET saved_revision=true WHERE tenant_id=$1 AND page_id=$2 AND left_at IS NULL",
          [ctx.tenantId, ctx.pageId],
        ).catch(() => {});
      } catch (error) {
        // Three attempts already failed. The Y.Doc stays in memory and the
        // next edit's debounce (or the final disconnect) tries again; only a
        // sustained BookStack outage combined with the document actually
        // unloading in between would lose this specific increment — earlier
        // successful saves already landed as real revisions regardless.
        console.error("[live-edit] onStoreDocument failed after retries", error);
      }
    },

    async afterUnloadDocument(data) {
      lastKnownRevision.delete(data.documentName);
    },

    async onDisconnect(data) {
      try {
        const ctx = data.context as LiveEditContext;
        if (!ctx?.tenantId) return;
        presenceLeave(ctx.documentName);
        db.query(
          `UPDATE live_edit_sessions SET left_at=now() WHERE id = (
             SELECT id FROM live_edit_sessions
             WHERE tenant_id=$1 AND page_id=$2 AND bookstack_user_id=$3 AND left_at IS NULL
             ORDER BY joined_at DESC LIMIT 1
           )`,
          [ctx.tenantId, ctx.pageId, ctx.bookstackUserId],
        ).catch(() => {});
      } catch (error) {
        console.error("[live-edit] onDisconnect bookkeeping failed", error);
      }
    },
  });
  return instance;
}
