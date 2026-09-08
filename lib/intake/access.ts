import { db } from "@/lib/db";
import { BookStack } from "./bookstack";
import { decrypt } from "./crypto";
export class IntakeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const uuid = (value: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export async function workspace(userId: string, tenantId: string) {
  if (!uuid(tenantId)) throw new IntakeError("Workspace not found.", 404);
  const row = (
    await db.query(
      `SELECT t.id,t.team_id,t.slug,t.status,t.desired_state,m.role,(SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' ELSE status END FROM subscriptions WHERE team_id=t.team_id ORDER BY updated_at DESC LIMIT 1) AS subscription_status FROM tenants t JOIN memberships m ON m.team_id=t.team_id WHERE t.id=$1 AND m.user_id=$2`,
      [tenantId, userId],
    )
  ).rows[0];
  if (!row) throw new IntakeError("Workspace not found.", 404);
  if (
    row.status !== "running" ||
    row.desired_state !== "running" ||
    !["trialing", "active"].includes(row.subscription_status)
  )
    throw new IntakeError("Your workspace is not running.", 409);
  return row;
}
export async function itemForUser(userId: string, id: string) {
  if (!uuid(id)) throw new IntakeError("Document not found.", 404);
  const row = (
    await db.query(
      `SELECT i.*,m.role,t.slug,t.status AS tenant_status,t.desired_state,(SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' ELSE status END FROM subscriptions WHERE team_id=t.team_id ORDER BY updated_at DESC LIMIT 1) AS subscription_status FROM intake_items i JOIN tenants t ON t.id=i.tenant_id AND t.team_id=i.team_id JOIN memberships m ON m.team_id=i.team_id WHERE i.id=$1 AND m.user_id=$2`,
      [id, userId],
    )
  ).rows[0];
  if (!row) throw new IntakeError("Document not found.", 404);
  if (
    row.tenant_status !== "running" ||
    row.desired_state !== "running" ||
    !["trialing", "active"].includes(row.subscription_status)
  )
    throw new IntakeError("Your workspace is not running.", 409);
  return row;
}
export async function clientFor(tenant: { id: string; slug: string }) {
  const secret = (
    await db.query(
      "SELECT api_id,api_secret_enc FROM tenant_secrets WHERE tenant_id=$1",
      [tenant.id],
    )
  ).rows[0];
  if (!secret)
    throw new IntakeError(
      "Document intake is being prepared. Please contact support.",
      503,
    );
  return new BookStack(
    tenant.slug,
    secret.api_id,
    decrypt(secret.api_secret_enc, tenant.slug),
  );
}
export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof IntakeError
          ? error.message
          : "The request could not be completed. Please try again or contact support.",
    },
    {
      status: error instanceof IntakeError ? error.status : 503,
      headers:
        error instanceof IntakeError && error.status === 429
          ? { "Retry-After": "30" }
          : {},
    },
  );
}
export async function boundedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new IntakeError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new IntakeError("Request body is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new IntakeError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    headers: {
      "content-type":
        request.headers.get("content-type") || "application/octet-stream",
    },
  });
}
