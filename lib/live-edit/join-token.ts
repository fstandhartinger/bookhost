import { createHmac, timingSafeEqual } from "node:crypto";

// A separate, server-owned signed token (distinct from the BookStack-issued
// ticket) that authorizes exactly one WebSocket join to exactly one Yjs
// document. Minted by POST /api/live-edit/join after verifying the BookStack
// ticket and the fidelity check; verified again in Hocuspocus's onAuthenticate
// so the two checks can never be skipped independently. Self-contained and
// short-lived, so the WS handshake needs no DB round trip.
export type JoinToken = {
  tenant: string;
  pageId: number;
  documentName: string;
  bookstackUserId: number;
  userName: string;
  userColor: string;
  canEdit: boolean;
  exp: number;
};

function secret() {
  const value = process.env.LIVE_EDIT_JOIN_SECRET || process.env.AUTH_SECRET;
  if (!value || value.length < 16)
    throw new Error("Live Edit join signing is not configured.");
  return value;
}

export function documentNameFor(tenant: string, pageId: number) {
  return `${tenant}:${pageId}`;
}

export function signJoinToken(payload: Omit<JoinToken, "exp">, ttlSeconds = 90) {
  const full: JoinToken = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const json = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret()).update(json).digest("base64url");
  return `${json}.${sig}`;
}

export function verifyJoinToken(token: string): JoinToken | null {
  if (typeof token !== "string" || token.length > 4096) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const json = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: Buffer;
  let given: Buffer;
  try {
    expected = Buffer.from(
      createHmac("sha256", secret()).update(json).digest("base64url"),
    );
    given = Buffer.from(sig);
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return null;
  try {
    const payload = JSON.parse(Buffer.from(json, "base64url").toString("utf8"));
    if (
      typeof payload?.tenant !== "string" ||
      typeof payload?.documentName !== "string" ||
      !Number.isSafeInteger(payload?.pageId) ||
      !Number.isSafeInteger(payload?.bookstackUserId) ||
      typeof payload?.canEdit !== "boolean" ||
      !Number.isFinite(payload?.exp) ||
      payload.exp < Math.floor(Date.now() / 1000)
    )
      return null;
    return payload as JoinToken;
  } catch {
    return null;
  }
}
