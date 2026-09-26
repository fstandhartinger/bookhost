import { createHash, randomBytes } from "node:crypto";
import { db, transaction } from "@/lib/db";
import { encrypt } from "@/lib/intake/crypto";
import { clientFor, IntakeError, uuid, workspace } from "@/lib/intake/access";
import { tenantHost } from "@/lib/tenant-host";
import { agentSettings, WRITE_MODES, type WriteMode } from "./access";
import { recentActivity } from "./activity";

export const MAX_AGENTS = 20;
// Roles an agent may never receive: full admin, the guest role, and BookHost's
// own service roles. The host worker enforces the same list again.
export const FORBIDDEN_ROLE_SYSTEM_NAMES = [
  "admin",
  "public",
  "wissen-intake",
  "bookhost-agent-api",
];

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomToken(length = 32) {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      // 248 = 4 * 62: rejection sampling keeps the alphabet uniform.
      if (byte < 248 && out.length < length) out += ALPHABET[byte % 62];
    }
  }
  return out;
}

export async function managedWorkspace(userId: string, tenantId: string) {
  const ws = await workspace(userId, tenantId);
  if (!["owner", "admin"].includes(ws.role))
    throw new IntakeError(
      "Only workspace owners and admins can manage agent access.",
      403,
    );
  return ws;
}

type Role = {
  id: number;
  display_name: string;
  system_name?: string | null;
  description?: string;
};
export async function assignableRoles(ws: {
  id: string;
  slug: string;
  host?: string | null;
}) {
  const client = await clientFor({
    id: ws.id,
    slug: ws.slug,
    host: tenantHost({ slug: ws.slug, host: ws.host }),
  });
  const roles: Role[] = [];
  for (let offset = 0; offset <= 2000; offset += 500) {
    const page = await client.request<{ data: Role[]; total: number }>(
      `roles?count=500&offset=${offset}`,
    );
    roles.push(...page.data);
    if (roles.length >= page.total || !page.data.length) break;
  }
  return roles
    .filter(
      (r) =>
        !FORBIDDEN_ROLE_SYSTEM_NAMES.includes(r.system_name || "") &&
        r.display_name !== "BookHost Intake",
    )
    .map((r) => ({
      id: r.id,
      name: r.display_name,
      description: (r.description || "").slice(0, 200),
    }));
}

export async function overview(userId: string, tenantId: string) {
  const ws = await managedWorkspace(userId, tenantId);
  const settings = await agentSettings(ws.id);
  const agents = (
    await db.query(
      "SELECT id,name,role_name,status,error,created_at,revoked_at,token_id FROM agents WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100",
      [ws.id],
    )
  ).rows.map((a) => ({
    id: a.id,
    name: a.name,
    role_name: a.role_name,
    status: a.status,
    error: a.error,
    created_at: a.created_at,
    revoked_at: a.revoked_at,
    // Only a short prefix of the public token id, to match it in BookStack.
    token_hint: `${String(a.token_id).slice(0, 6)}…`,
  }));
  let roles: { id: number; name: string; description: string }[] = [];
  let rolesError: string | null = null;
  try {
    roles = await assignableRoles(ws);
  } catch (error) {
    rolesError =
      error instanceof IntakeError
        ? error.message
        : "BookStack roles could not be loaded.";
  }
  const host = tenantHost(ws);
  return {
    workspace: {
      id: ws.id,
      host,
      mcp_url: `https://${host}/mcp`,
      llms_url: `https://${host}/llms.txt`,
    },
    settings,
    agents,
    roles,
    roles_error: rolesError,
    activity: await recentActivity(ws.id, 100),
  };
}

export async function setWriteMode(
  userId: string,
  tenantId: string,
  mode: unknown,
) {
  const ws = await managedWorkspace(userId, tenantId);
  if (typeof mode !== "string" || !WRITE_MODES.includes(mode as WriteMode))
    throw new IntakeError("Choose Off, Propose only or Direct.");
  await db.query(
    `INSERT INTO agent_settings(tenant_id,write_mode,updated_by) VALUES($1,$2,$3)
     ON CONFLICT(tenant_id) DO UPDATE SET write_mode=EXCLUDED.write_mode,updated_by=EXCLUDED.updated_by,updated_at=now()`,
    [ws.id, mode, userId],
  );
  return { ok: true };
}

// Kill switch: blocks every agent request for this workspace immediately (the
// MCP endpoint checks this flag on every call) and queues every
// dashboard-created token for deletion in BookStack.
export async function setAccess(
  userId: string,
  tenantId: string,
  enabled: unknown,
) {
  const ws = await managedWorkspace(userId, tenantId);
  if (typeof enabled !== "boolean") throw new IntakeError("Invalid request.");
  return transaction(async (c) => {
    // Same per-workspace lock as createAgent: no agent can be created between
    // switching access off and revoking the existing tokens.
    await c.query("SELECT 1 FROM tenants WHERE id=$1 FOR UPDATE", [ws.id]);
    await c.query(
      `INSERT INTO agent_settings(tenant_id,access_enabled,disabled_at,updated_by) VALUES($1,$2,CASE WHEN $2 THEN NULL ELSE now() END,$3)
       ON CONFLICT(tenant_id) DO UPDATE SET access_enabled=EXCLUDED.access_enabled,disabled_at=EXCLUDED.disabled_at,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [ws.id, enabled, userId],
    );
    let revoked = 0;
    if (!enabled) {
      revoked =
        (
          await c.query(
            "UPDATE agents SET status='revoke_requested',bookstack_secret_enc=NULL,updated_at=now() WHERE tenant_id=$1 AND status IN ('pending','active','failed') RETURNING id",
            [ws.id],
          )
        ).rowCount || 0;
    }
    return { ok: true, revoked };
  });
}

export async function createAgent(
  userId: string,
  tenantId: string,
  input: { name?: unknown; role_id?: unknown },
) {
  const ws = await managedWorkspace(userId, tenantId);
  const settings = await agentSettings(ws.id);
  if (!settings.access_enabled)
    throw new IntakeError(
      "Agent access is switched off. Switch it on before creating an agent.",
      409,
    );
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 60 || /[<>\p{Cc}]/u.test(name))
    throw new IntakeError("Enter an agent name of up to 60 characters.");
  const roleId = Number(input.role_id);
  if (!Number.isSafeInteger(roleId) || roleId < 1)
    throw new IntakeError("Choose a BookStack role.");
  const role = (await assignableRoles(ws)).find((r) => r.id === roleId);
  if (!role)
    throw new IntakeError(
      "This BookStack role cannot be given to an agent.",
      400,
    );
  const tokenId = randomToken();
  // Two different secrets: BookStack gets bookstackSecret (the agent never
  // sees it); the agent gets gatewaySecret, which only the MCP endpoint accepts.
  const bookstackSecret = randomToken();
  const gatewaySecret = randomToken();
  const agent = await transaction(async (c) => {
    // Serialise per workspace so the agent cap and the kill switch hold under
    // concurrent requests.
    await c.query("SELECT 1 FROM tenants WHERE id=$1 FOR UPDATE", [ws.id]);
    const enabled = (
      await c.query(
        "SELECT access_enabled FROM agent_settings WHERE tenant_id=$1",
        [ws.id],
      )
    ).rows[0];
    if (enabled && !enabled.access_enabled)
      throw new IntakeError(
        "Agent access is switched off. Switch it on before creating an agent.",
        409,
      );
    const count = Number(
      (
        await c.query(
          "SELECT count(*) FROM agents WHERE tenant_id=$1 AND status IN ('pending','active')",
          [ws.id],
        )
      ).rows[0].count,
    );
    if (count >= MAX_AGENTS)
      throw new IntakeError(
        `A workspace can have up to ${MAX_AGENTS} active agents. Revoke one first.`,
        409,
      );
    return (
      await c.query(
        "INSERT INTO agents(tenant_id,name,role_id,role_name,token_id,gateway_hash,bookstack_secret_enc,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,role_name,status,created_at",
        [
          ws.id,
          name,
          role.id,
          role.name,
          tokenId,
          createHash("sha256").update(gatewaySecret).digest("hex"),
          encrypt(bookstackSecret, ws.slug),
          userId,
        ],
      )
    ).rows[0];
  });
  // Shown once; BookHost stores only its hash. It works on the workspace's MCP
  // endpoint only — not against the BookStack API directly.
  return { agent, token: `${tokenId}:${gatewaySecret}` };
}

export async function revokeAgent(
  userId: string,
  tenantId: string,
  agentId: unknown,
) {
  const ws = await managedWorkspace(userId, tenantId);
  if (typeof agentId !== "string" || !uuid(agentId))
    throw new IntakeError("Agent not found.", 404);
  const result = await db.query(
    "UPDATE agents SET status='revoke_requested',bookstack_secret_enc=NULL,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status IN ('pending','active','failed') RETURNING id",
    [agentId, ws.id],
  );
  if (!result.rowCount)
    throw new IntakeError("Agent not found or already revoked.", 404);
  return { ok: true };
}
