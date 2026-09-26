import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/intake/crypto";
import { IntakeError, workspace } from "@/lib/intake/access";

export type LiveEditSettings = {
  enabled: boolean;
  rollout_status: "none" | "pending" | "ready" | "failed";
  rollout_error: string | null;
};

export async function managedWorkspace(userId: string, tenantId: string) {
  const ws = await workspace(userId, tenantId);
  if (!["owner", "admin"].includes(ws.role))
    throw new IntakeError(
      "Only workspace owners and admins can manage Live Edit.",
      403,
    );
  return ws;
}

export async function liveEditSettings(
  tenantId: string,
): Promise<LiveEditSettings> {
  const row = (
    await db.query(
      "SELECT enabled,rollout_status,rollout_error FROM live_edit_settings WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows[0];
  return {
    enabled: row ? Boolean(row.enabled) : false,
    rollout_status: row?.rollout_status || "none",
    rollout_error: row?.rollout_error || null,
  };
}

// The feature is only really live for a workspace once the tenant-side
// BookStack theme route has been installed and verified by the host worker.
export async function liveEditReady(tenantId: string): Promise<boolean> {
  const settings = await liveEditSettings(tenantId);
  return settings.enabled && settings.rollout_status === "ready";
}

export async function setLiveEditEnabled(
  userId: string,
  tenantId: string,
  enabled: unknown,
) {
  const ws = await managedWorkspace(userId, tenantId);
  if (typeof enabled !== "boolean") throw new IntakeError("Invalid request.");
  if (!enabled) {
    // Turning it off only flips the control-plane gate; the harmless theme
    // route (if installed) stays in place so re-enabling is instant.
    await db.query(
      `INSERT INTO live_edit_settings(tenant_id,enabled,updated_by) VALUES($1,false,$2)
       ON CONFLICT(tenant_id) DO UPDATE SET enabled=false,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [ws.id, userId],
    );
    return { ok: true, rollout_status: "none" as const };
  }
  const existing = (
    await db.query(
      "SELECT rollout_status,hmac_secret_enc FROM live_edit_settings WHERE tenant_id=$1",
      [ws.id],
    )
  ).rows[0];
  // Generate the per-tenant secret once; never rotate it under an active
  // toggle flip, so an in-flight rollout keeps using the value it queued with.
  const secretEnc =
    existing?.hmac_secret_enc ||
    encrypt(randomBytes(32).toString("hex"), ws.slug);
  const rolloutStatus =
    existing?.rollout_status === "ready" ? "ready" : "pending";
  await db.query(
    `INSERT INTO live_edit_settings(tenant_id,enabled,rollout_status,hmac_secret_enc,rollout_error,updated_by)
     VALUES($1,true,$2,$3,NULL,$4)
     ON CONFLICT(tenant_id) DO UPDATE SET enabled=true,rollout_status=EXCLUDED.rollout_status,
       hmac_secret_enc=COALESCE(live_edit_settings.hmac_secret_enc,EXCLUDED.hmac_secret_enc),
       rollout_error=NULL,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [ws.id, rolloutStatus, secretEnc, userId],
  );
  return { ok: true, rollout_status: rolloutStatus };
}
