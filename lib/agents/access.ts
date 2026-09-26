import { createHash, timingSafeEqual } from "node:crypto";
import { decrypt } from "@/lib/intake/crypto";
import { db } from "@/lib/db";
import { tenantHost } from "@/lib/tenant-host";
import { TENANT_DOMAINS } from "@/lib/config";

export type WriteMode = "off" | "propose" | "direct";
export const WRITE_MODES: WriteMode[] = ["off", "propose", "direct"];

export type AgentWorkspace = {
  id: string;
  team_id: string | null;
  slug: string;
  host: string;
  running: boolean;
};

const SUBSCRIPTION_STATUS = `(SELECT CASE WHEN status='trialing' AND (trial_end IS NULL OR trial_end<=now()) THEN 'expired' WHEN status IN ('past_due','unpaid') AND payment_grace_until<=now() AND payment_failure_notified_at<now() THEN 'expired' ELSE status END FROM effective_subscriptions WHERE team_id=t.team_id)`;

export function requestHost(request: Request): string | null {
  const host = (request.headers.get("host") || "")
    .split(":")[0]
    .trim()
    .toLowerCase();
  if (!host || host.length > 253) return null;
  // Only workspace subdomains of our own tenant domains carry agent endpoints.
  const domain = TENANT_DOMAINS.find(
    (d) => host.endsWith(`.${d}`) && host !== `www.${d}`,
  );
  if (!domain) return null;
  const label = host.slice(0, -(domain.length + 1));
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? host : null;
}

// The workspace is chosen by the request host only; the token never selects it.
export async function workspaceForHost(
  host: string,
): Promise<AgentWorkspace | null> {
  const row = (
    await db.query(
      `SELECT t.id,t.team_id,t.slug,t.host,t.status,t.desired_state,${SUBSCRIPTION_STATUS} AS subscription_status
       FROM tenants t
       WHERE t.host=$1 OR (t.host IS NULL AND t.slug || '.wissen.app.mintapis.com'=$1)
       LIMIT 2`,
      [host],
    )
  ).rows;
  if (row.length !== 1) return null;
  const t = row[0];
  if (tenantHost(t) !== host) return null;
  return {
    id: t.id,
    team_id: t.team_id,
    slug: t.slug,
    host,
    running:
      t.status === "running" &&
      t.desired_state === "running" &&
      // The operator demo has no team and no subscription.
      (t.team_id === null ||
        ["trialing", "active", "past_due", "unpaid"].includes(
          t.subscription_status,
        )),
  };
}

export async function agentSettings(tenantId: string) {
  const row = (
    await db.query(
      "SELECT write_mode,access_enabled,disabled_at,updated_at FROM agent_settings WHERE tenant_id=$1",
      [tenantId],
    )
  ).rows[0];
  return {
    write_mode: (row?.write_mode || "propose") as WriteMode,
    access_enabled: row ? Boolean(row.access_enabled) : true,
    disabled_at: row?.disabled_at || null,
  };
}

export type ParsedToken = {
  tokenId: string;
  token: string;
  fingerprint: string;
  key: string;
};

// Accepts "Bearer <id>:<secret>" (MCP clients) and "Token <id>:<secret>"
// (BookStack's own format). Returns null for anything else.
export function parseToken(header: string | null): ParsedToken | null {
  const match =
    /^(?:Bearer|Token)\s+([A-Za-z0-9]{16,128}):([A-Za-z0-9]{16,128})\s*$/i.exec(
      header || "",
    );
  if (!match) return null;
  const token = `${match[1]}:${match[2]}`;
  return {
    tokenId: match[1],
    token,
    // Not reversible and not the secret: lets owners recognise a token in the log.
    fingerprint: createHash("sha256")
      .update(`bookhost-agent:${match[1]}`)
      .digest("hex")
      .slice(0, 12),
    // Rate-limit and cache key; binds the full token to the workspace.
    key: createHash("sha256").update(`${match[1]}:${match[2]}`).digest("hex"),
  };
}

export type AgentIdentity = {
  agentId: string | null;
  label: string;
};

const sha256 = (value: string) => createHash("sha256").update(value).digest();

// Local checks that must hold before any BookStack call: the internal service
// token never works here, dashboard-revoked agents stop immediately, and a
// dashboard agent's gateway secret is exchanged for its BookStack credential,
// which only BookHost holds. Other tokens are the caller's own BookStack token
// and are forwarded unchanged.
export async function localTokenCheck(
  workspace: { id: string; slug: string },
  token: ParsedToken,
): Promise<
  | { ok: true; identity: AgentIdentity; upstream: string }
  | { ok: false; reason: string; authFailure: boolean }
> {
  const service = (
    await db.query("SELECT api_id FROM tenant_secrets WHERE tenant_id=$1", [
      workspace.id,
    ])
  ).rows[0];
  if (service && service.api_id === token.tokenId)
    return {
      ok: false,
      authFailure: true,
      reason:
        "This token belongs to BookHost's internal service user and cannot be used for agent access.",
    };
  const agent = (
    await db.query(
      "SELECT id,name,status,gateway_hash,bookstack_secret_enc FROM agents WHERE tenant_id=$1 AND token_id=$2",
      [workspace.id, token.tokenId],
    )
  ).rows[0];
  if (!agent)
    return {
      ok: true,
      identity: {
        agentId: null,
        label: `BookStack token ${token.fingerprint}`,
      },
      upstream: token.token,
    };
  const expected = Buffer.from(String(agent.gateway_hash), "hex");
  const given = sha256(token.token.slice(token.tokenId.length + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, authFailure: true, reason: "Invalid agent token." };
  if (agent.status === "pending")
    return {
      ok: false,
      authFailure: false,
      reason: "This agent token is still being set up. Try again in a minute.",
    };
  if (agent.status !== "active" || !agent.bookstack_secret_enc)
    return {
      ok: false,
      authFailure: false,
      reason: "This agent token was revoked.",
    };
  return {
    ok: true,
    identity: { agentId: agent.id, label: agent.name },
    upstream: `${token.tokenId}:${decrypt(agent.bookstack_secret_enc, workspace.slug)}`,
  };
}
