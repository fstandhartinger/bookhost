import { createHash } from "node:crypto";
import { PUBLIC_BASE_URL } from "@/lib/config";
import { db } from "@/lib/db";
import { clientFor, IntakeError } from "@/lib/intake/access";
import { tenantHost } from "@/lib/tenant-host";
import { verifyBookStackTicket, TicketError } from "@/lib/live-edit/bookstack-ticket";
import { fidelityBlockers } from "@/lib/live-edit/fidelity";
import { documentNameFor, signJoinToken } from "@/lib/live-edit/join-token";
import { corsHeaders, corsPreflight } from "@/lib/live-edit/cors";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return corsPreflight(request);
}

// A small fixed palette (readable on light and dark BookStack themes),
// chosen deterministically per BookStack user id so the same person keeps
// the same cursor colour across sessions without storing anything.
const COLORS = [
  "#e64980", "#7048e8", "#1c7ed6", "#0ca678",
  "#f08c00", "#e8590c", "#2f9e44", "#495057",
];
function colorFor(bookstackUserId: number) {
  const hash = createHash("sha256").update(String(bookstackUserId)).digest();
  return COLORS[hash[0] % COLORS.length];
}

export async function POST(request: Request) {
  const headers = await corsHeaders(request);
  const json = (body: unknown) => Response.json(body, { headers });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "Invalid request." });
  }
  if (!body || typeof body !== "object")
    return json({ ok: false, reason: "Invalid request." });
  const { ticket, sig } = body as Record<string, unknown>;

  try {
    const claim = await verifyBookStackTicket(ticket, sig);
    const tenant = (
      await db.query(
        "SELECT id,slug,host FROM tenants WHERE slug=$1 AND status='running' AND desired_state='running'",
        [claim.tenant],
      )
    ).rows[0];
    if (!tenant) return json({ ok: false, reason: "Workspace not found." });

    const client = await clientFor({
      id: tenant.id,
      slug: tenant.slug,
      host: tenantHost(tenant),
    });
    const page = await client.request<{ html: string; editor: string }>(
      `pages/${claim.pageId}`,
    );
    const blockers = fidelityBlockers(page.html || "", claim.editorType);
    if (blockers.length) return json({ ok: false, reason: blockers[0].reason });

    const documentName = documentNameFor(tenant.slug, claim.pageId);
    const joinToken = signJoinToken({
      tenant: tenant.slug,
      pageId: claim.pageId,
      documentName,
      bookstackUserId: claim.bookstackUserId,
      userName: claim.userName,
      userColor: colorFor(claim.bookstackUserId),
      canEdit: claim.canEdit,
    });

    return json({
      ok: true,
      wsUrl: PUBLIC_BASE_URL.replace(/^http/, "ws") + "/live-edit-ws",
      documentName,
      joinToken,
      canEdit: claim.canEdit,
      userName: claim.userName,
      userColor: colorFor(claim.bookstackUserId),
    });
  } catch (error) {
    if (error instanceof TicketError || error instanceof IntakeError)
      return json({ ok: false, reason: error.message });
    return json({
      ok: false,
      reason: "Live Edit could not start. Try again shortly.",
    });
  }
}
