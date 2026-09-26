import { db } from "@/lib/db";

export type ActivityStatus = "ok" | "proposed" | "denied" | "error" | "rate_limited";

// Metadata only: which token/agent, which tool, which object id, outcome and
// latency. Never arguments, page content, search terms or secrets.
export async function logActivity(entry: {
  tenantId: string;
  agentId: string | null;
  fingerprint: string;
  tool: string;
  target?: string | null;
  status: ActivityStatus;
  latencyMs: number;
}) {
  try {
    await db.query(
      "INSERT INTO agent_activity(tenant_id,agent_id,token_fingerprint,tool,target,status,latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        entry.tenantId,
        entry.agentId,
        entry.fingerprint,
        entry.tool.slice(0, 40),
        entry.target ? entry.target.slice(0, 80) : null,
        entry.status,
        Math.max(0, Math.round(entry.latencyMs)),
      ],
    );
  } catch {
    console.error("Agent activity log write failed");
  }
}

export async function recentActivity(tenantId: string, limit = 100) {
  return (
    await db.query(
      `SELECT a.id,a.tool,a.target,a.status,a.latency_ms,a.created_at,a.token_fingerprint,g.name AS agent_name
       FROM agent_activity a LEFT JOIN agents g ON g.id=a.agent_id
       WHERE a.tenant_id=$1 ORDER BY a.created_at DESC, a.id DESC LIMIT $2`,
      [tenantId, limit],
    )
  ).rows;
}

export async function cleanupAgentActivity() {
  await db.query(
    "DELETE FROM agent_activity WHERE created_at<now()-interval '90 days'",
  );
}
