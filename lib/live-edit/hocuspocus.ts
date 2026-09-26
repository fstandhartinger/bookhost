import { Hocuspocus } from "@hocuspocus/server";
import { db } from "@/lib/db";
import { clientFor, IntakeError } from "@/lib/intake/access";
import { tenantHost } from "@/lib/tenant-host";
import { verifyJoinToken } from "./join-token";
import { seedYdocFromHtml, htmlFromYdoc } from "./tiptap-bridge";
import { presenceJoin, presenceLeave } from "./presence-store";

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
      const page = await client.request<{ html: string }>(
        `pages/${ctx.pageId}`,
      );
      return seedYdocFromHtml(page.html || "");
    },

    async onStoreDocument(data) {
      const ctx = data.lastContext as LiveEditContext;
      if (!ctx?.tenantId) return;
      const client = await clientFor({
        id: ctx.tenantId,
        slug: ctx.tenantSlug,
        host: ctx.tenantHost,
      });
      const html = htmlFromYdoc(data.document);
      await client.request(
        `pages/${ctx.pageId}`,
        { html, changelog: "Live edit session" },
        "PUT",
      );
      db.query(
        "UPDATE live_edit_sessions SET saved_revision=true WHERE tenant_id=$1 AND page_id=$2 AND left_at IS NULL",
        [ctx.tenantId, ctx.pageId],
      ).catch(() => {});
    },

    async onDisconnect(data) {
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
    },
  });
  return instance;
}
