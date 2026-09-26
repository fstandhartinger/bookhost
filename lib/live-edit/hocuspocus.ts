import { Hocuspocus, type onStoreDocumentPayload } from "@hocuspocus/server";
import { db } from "@/lib/db";
import { clientFor, IntakeError } from "@/lib/intake/access";
import { tenantHost } from "@/lib/tenant-host";
import {
  BookStackConflictSavedError,
  BookStackSaveError,
  saveBookStackPage,
} from "./bookstack-save";
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

// The revision_count BookHost last saw for a document. Saves carry this to the
// tenant-side theme route, which verifies it under a database row lock. Cleared
// in afterUnloadDocument.
const lastKnownRevision = new Map<string, number>();
const documentTenants = new Map<string, string>();
const conflictedDocuments = new Set<string>();
const lastStoreContexts = new Map<string, LiveEditContext>();
const retryTimers = new Map<string, NodeJS.Timeout>();
const retryCounts = new Map<string, number>();

let instance: Hocuspocus | null = null;
let revocationTimer: NodeJS.Timeout | null = null;

function clearSaveRetry(documentName: string) {
  const timer = retryTimers.get(documentName);
  if (timer) clearTimeout(timer);
  retryTimers.delete(documentName);
  retryCounts.delete(documentName);
}

function scheduleSaveRetry(data: onStoreDocumentPayload<LiveEditContext>) {
  const documentName = data.documentName;
  if (retryTimers.has(documentName) || conflictedDocuments.has(documentName))
    return;
  const attempt = (retryCounts.get(documentName) || 0) + 1;
  retryCounts.set(documentName, attempt);
  const delayMs = Math.min(30_000, 5_000 * 2 ** Math.min(attempt - 1, 3));
  const timer = setTimeout(() => {
    retryTimers.delete(documentName);
    const server = data.instance;
    const document = server.documents.get(documentName);
    if (!document || conflictedDocuments.has(documentName)) return;
    const context = lastStoreContexts.get(documentName) || data.lastContext;
    void server.storeDocumentHooks(
      document,
      {
        ...data,
        document,
        clientsCount: document.getConnectionsCount(),
        lastContext: context,
      },
      true,
    );
  }, delayMs);
  timer.unref();
  retryTimers.set(documentName, timer);
}

function startRevocationMonitor(server: Hocuspocus) {
  if (revocationTimer) return;
  revocationTimer = setInterval(() => {
    void (async () => {
      const entries = [...documentTenants.entries()];
      const tenantIds = [...new Set(entries.map(([, tenantId]) => tenantId))];
      if (!tenantIds.length) return;
      try {
        const rows = (
          await db.query(
            `SELECT tenant_id FROM live_edit_settings
             WHERE tenant_id=ANY($1::uuid[]) AND enabled=true AND rollout_status='ready'`,
            [tenantIds],
          )
        ).rows;
        const ready = new Set(rows.map((row) => row.tenant_id as string));
        for (const [documentName, tenantId] of entries) {
          if (ready.has(tenantId)) continue;
          const document = server.documents.get(documentName);
          if (document?.getConnectionsCount())
            server.closeConnections(documentName);
        }
      } catch {
        // A temporary control-plane DB error must not evict healthy sessions.
        console.error("[live-edit] could not check disabled workspaces");
      }
    })();
  }, 5000);
  revocationTimer.unref();
}

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
      if (conflictedDocuments.has(payload.documentName))
        throw new Error("This Live Edit session ended after preserving a conflict revision. Reopen the page.");
      const tenant = await tenantForSlug(payload.tenant);
      if (!(await liveEditReady(tenant.id)))
        throw new Error("Live Edit is turned off for this workspace.");
      documentTenants.set(payload.documentName, tenant.id);
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
      if (conflictedDocuments.has(data.documentName)) return;
      try {
        const ctx = data.lastContext as LiveEditContext;
        if (!ctx?.tenantId || !ctx.canEdit)
          throw new BookStackSaveError("No authorized Live Edit editor is available to save this page.", false);
        lastStoreContexts.set(data.documentName, ctx);

        // Turning the beta off doesn't push-revoke already-open sockets on
        // its own; piggyback the check on this same periodic cycle (every
        // <=15s while dirty, or immediately on the final disconnect) so a
        // disabled workspace's live sessions wind down quickly without a
        // separate polling mechanism.
        if (!(await liveEditReady(ctx.tenantId))) {
          data.instance.closeConnections(data.documentName);
        }

        const expected = lastKnownRevision.get(data.documentName);
        if (expected === undefined)
          throw new BookStackSaveError("The original BookStack revision is unavailable.", false);

        const html = htmlFromYdoc(data.document);
        let savedRevision: number | undefined;
        let lastError: unknown;
        for (const delayMs of [0, 1000, 3000]) {
          if (delayMs) await sleep(delayMs);
          try {
            savedRevision = await saveBookStackPage({
              tenantId: ctx.tenantId,
              tenantSlug: ctx.tenantSlug,
              tenantHost: ctx.tenantHost,
              pageId: ctx.pageId,
              bookstackUserId: ctx.bookstackUserId,
              expectedRevisionCount: expected,
              html,
            });
            lastError = undefined;
            break;
          } catch (error) {
            if (error instanceof BookStackConflictSavedError) {
              conflictedDocuments.add(data.documentName);
              lastKnownRevision.set(data.documentName, error.revisionCount);
              clearSaveRetry(data.documentName);
              data.document.broadcastStateless(
                JSON.stringify({
                  type: "bookhost-live-edit-save-conflict",
                  message:
                    "A BookStack edit was saved at the same time. Your Live Edit changes are preserved as a separate revision in BookStack history; this session is closing so neither version overwrites the other.",
                }),
              );
              const closeTimer = setTimeout(
                () => data.instance.closeConnections(data.documentName),
                0,
              );
              closeTimer.unref();
              db.query(
                "UPDATE live_edit_sessions SET saved_revision=true WHERE tenant_id=$1 AND page_id=$2 AND left_at IS NULL",
                [ctx.tenantId, ctx.pageId],
              ).catch(() => {});
              return;
            }
            if (error instanceof BookStackSaveError && !error.retryable)
              throw error;
            lastError = error;
          }
        }
        if (lastError) throw lastError;

        if (savedRevision === undefined)
          throw new BookStackSaveError("BookStack did not confirm the Live Edit save.");
        lastKnownRevision.set(data.documentName, savedRevision);
        clearSaveRetry(data.documentName);
        data.document.broadcastStateless(
          JSON.stringify({ type: "bookhost-live-edit-save-ok" }),
        );
        db.query(
          "UPDATE live_edit_sessions SET saved_revision=true WHERE tenant_id=$1 AND page_id=$2 AND left_at IS NULL",
          [ctx.tenantId, ctx.pageId],
        ).catch(() => {});
      } catch (error) {
        const reason =
          error instanceof BookStackConflictSavedError
            ? "conflict"
            : "save-failed";
        data.document.broadcastStateless(
          JSON.stringify({
            type: "bookhost-live-edit-save-error",
            reason,
            message:
              reason === "conflict"
                ? "The page changed in BookStack. Keep this Live Edit window open while the changes are saved to revision history."
                : "BookStack has not confirmed this save. Keep this Live Edit window open; Live Edit will retry automatically.",
          }),
        );
        if (!(error instanceof BookStackSaveError) || error.retryable)
          scheduleSaveRetry(data);
        throw error;
      }
    },

    async afterUnloadDocument(data) {
      lastKnownRevision.delete(data.documentName);
      documentTenants.delete(data.documentName);
      conflictedDocuments.delete(data.documentName);
      lastStoreContexts.delete(data.documentName);
      clearSaveRetry(data.documentName);
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
  startRevocationMonitor(instance);
  return instance;
}

// Used by the custom server during graceful shutdown. Hocuspocus fires its
// pending final store when the last connection closes; wait for the document
// registry to drain before allowing the process to exit.
export async function waitForLiveEditFlush(timeoutMs = 25_000) {
  if (!instance) return;
  instance.closeConnections();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (instance.getConnectionsCount() === 0 && instance.getDocumentsCount() === 0)
      return;
    await sleep(100);
  }
  console.error(
    `[live-edit] shutdown flush timed out with ${instance.getDocumentsCount()} documents still in memory`,
  );
}
