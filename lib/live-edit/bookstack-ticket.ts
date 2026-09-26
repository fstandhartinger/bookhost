import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/intake/crypto";

// Issued by the tenant's own BookStack instance (theme route
// `live-edit/ticket/{pageId}`, ops/provisioner/themes/live-edit/functions.php),
// using BookStack's real, per-user, per-page permission checks
// (userCan('page-view'|'page-update', $page)). We never recompute BookStack
// permissions ourselves — we only verify that this exact payload was really
// signed by that one tenant's secret and hasn't expired. That keeps BookStack
// the single source of truth for who may view/edit which page.
export type BookStackTicket = {
  tenant: string;
  pageId: number;
  bookstackUserId: number;
  userName: string;
  userEmail: string;
  canEdit: boolean;
  editorType: string;
  exp: number;
};

export class TicketError extends Error {
  constructor(
    message: string,
    readonly status = 403,
  ) {
    super(message);
  }
}

export async function liveEditTenantSecret(
  tenantId: string,
  tenantSlug: string,
): Promise<string> {
  const settings = (
    await db.query(
      "SELECT hmac_secret_enc FROM live_edit_settings WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows[0];
  if (!settings?.hmac_secret_enc)
    throw new TicketError("Live Edit is not set up for this workspace.", 404);
  return decrypt(settings.hmac_secret_enc, tenantSlug);
}

function isTicket(value: unknown): value is BookStackTicket {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.tenant === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(v.tenant) &&
    Number.isSafeInteger(v.pageId) &&
    (v.pageId as number) > 0 &&
    Number.isSafeInteger(v.bookstackUserId) &&
    (v.bookstackUserId as number) > 0 &&
    typeof v.userName === "string" &&
    v.userName.length <= 200 &&
    typeof v.userEmail === "string" &&
    v.userEmail.length <= 320 &&
    typeof v.canEdit === "boolean" &&
    typeof v.editorType === "string" &&
    Number.isFinite(v.exp)
  );
}

export async function verifyBookStackTicket(
  ticket: unknown,
  sig: unknown,
): Promise<BookStackTicket> {
  if (typeof ticket !== "string" || typeof sig !== "string" || !sig)
    throw new TicketError("Invalid ticket.", 400);
  if (ticket.length > 4096 || !/^[a-f0-9]{1,256}$/i.test(sig))
    throw new TicketError("Invalid ticket.", 400);
  let json: string;
  let payload: unknown;
  try {
    json = Buffer.from(ticket, "base64url").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    throw new TicketError("Invalid ticket.", 400);
  }
  if (!isTicket(payload)) throw new TicketError("Invalid ticket.", 400);
  const settings = (
    await db.query(
      `SELECT s.hmac_secret_enc, s.enabled, s.rollout_status
       FROM live_edit_settings s JOIN tenants t ON t.id=s.tenant_id
       WHERE t.slug=$1`,
      [payload.tenant],
    )
  ).rows[0];
  if (!settings?.hmac_secret_enc)
    throw new TicketError("Live Edit is not set up for this workspace.", 404);
  const secret = decrypt(settings.hmac_secret_enc, payload.tenant);
  const expected = createHmac("sha256", secret).update(json).digest("hex");
  const given = Buffer.from(sig, "hex");
  const wanted = Buffer.from(expected, "hex");
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
    throw new TicketError("Ticket signature does not match.", 403);
  if (payload.exp < Math.floor(Date.now() / 1000))
    throw new TicketError("This Live Edit link expired. Try again.", 403);
  if (!settings.enabled || settings.rollout_status !== "ready")
    throw new TicketError("Live Edit is turned off for this workspace.", 409);
  return payload;
}
