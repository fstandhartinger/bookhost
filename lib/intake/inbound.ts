import { requireInboundEmail } from "./inbound-enabled";
import type { Pool, PoolClient } from "pg";
import { db, transaction } from "@/lib/db";
import { clientFor, IntakeError } from "./access";
import { parseEmail, senderAllowed } from "./email";
import { rateLimit } from "@/lib/security";
const tenantSql = `SELECT t.*,s.status AS subscription_status FROM tenants t JOIN effective_subscriptions s ON s.team_id=t.team_id WHERE t.slug=$1 AND t.status='running' AND t.desired_state='running' AND (s.status='active' OR (s.status='trialing' AND s.trial_end>now()) OR (s.status IN ('past_due','unpaid') AND (s.payment_grace_until>now() OR s.payment_failure_notified_at IS NULL OR s.payment_failure_notified_at>=now())))`;
// The caller supplies the connection; this helper never acquires a pool connection.
async function replay(c: Pool | PoolClient, messageId: string, teamId: string) {
  const previous = (
    await c.query(
      "SELECT team_id,item_ids FROM intake_messages WHERE message_id=$1",
      [messageId],
    )
  ).rows[0];
  if (!previous) return null;
  if (previous.team_id !== teamId)
    throw new IntakeError("Message ID already used.", 409);
  const existing = await c.query(
    "SELECT id FROM intake_items WHERE id=ANY($1::uuid[])",
    [previous.item_ids],
  );
  if (
    existing.rowCount !== previous.item_ids.length ||
    !previous.item_ids.length
  )
    throw new IntakeError("Message documents have expired.", 410);
  return previous.item_ids as string[];
}
export async function acceptEmail(mail: ReturnType<typeof parseEmail>) {
  requireInboundEmail("admission");
  const tenant = (await db.query(tenantSql, [mail.slug])).rows[0];
  if (!tenant)
    throw new IntakeError("Workspace not found or not running.", 404);
  const members = (
    await db.query(
      "SELECT u.email,m.user_id,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1",
      [tenant.team_id],
    )
  ).rows;
  const patterns = (
    await db.query("SELECT pattern FROM intake_senders WHERE team_id=$1", [
      tenant.team_id,
    ])
  ).rows;
  if (
    !senderAllowed(
      mail.from.address,
      members.map((m) => m.email),
      patterns.map((p) => p.pattern),
    )
  ) {
    await db.query(
      "INSERT INTO events(name,team_id) VALUES('inbound_rejected',$1)",
      [tenant.team_id],
    );
    throw new IntakeError("Sender is not allowed.", 403);
  }
  const previous = await replay(db, mail.message_id, tenant.team_id);
  if (previous) return previous;
  if (!(await rateLimit(`intake-team:${tenant.team_id}`, 60)))
    throw new IntakeError("Intake rate limit reached.", 429);
  const actor =
    members.find((m) => m.role === "owner") ||
    members.find((m) => m.role === "admin");
  if (!actor) throw new IntakeError("Workspace intake is unavailable.", 503);
  const client = await clientFor(tenant);
  const books = await client.list("books");
  const last = (
    await db.query(
      "SELECT target_book_id FROM intake_items WHERE team_id=$1 ORDER BY created_at DESC LIMIT 1",
      [tenant.team_id],
    )
  ).rows[0];
  const book =
    books.find((b) => b.id === last?.target_book_id) ||
    books.find((b) => b.name === "Team handbook") ||
    (await client.request<{ id: number; name: string }>("books", {
      name: "Team handbook",
    }));
  try {
    return await transaction(async (c) => {
      requireInboundEmail("admission_commit");
      // Only this connection is used while holding the workspace lock. No HTTP here.
      const current = (
        await c.query(tenantSql + " FOR UPDATE OF t", [mail.slug])
      ).rows[0];
      if (!current || current.team_id !== tenant.team_id)
        throw new IntakeError("Workspace not found or not running.", 404);
      const allowed = await c.query(
        `SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 AND lower(u.email)=$2 UNION ALL SELECT 1 FROM intake_senders WHERE team_id=$1 AND (pattern=$2 OR pattern=$3)`,
        [
          tenant.team_id,
          mail.from.address,
          mail.from.address.slice(mail.from.address.lastIndexOf("@")),
        ],
      );
      if (!allowed.rowCount)
        throw new IntakeError("Sender is not allowed.", 403);
      const actorStillAllowed = await c.query(
        "SELECT 1 FROM memberships WHERE team_id=$1 AND user_id=$2 AND role IN ('owner','admin')",
        [tenant.team_id, actor.user_id],
      );
      if (!actorStillAllowed.rowCount)
        throw new IntakeError("Workspace intake is unavailable.", 503);
      const inserted = await c.query(
        "INSERT INTO intake_messages(message_id,team_id) VALUES($1,$2) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
        [mail.message_id, tenant.team_id],
      );
      if (!inserted.rowCount)
        return (await replay(c, mail.message_id, tenant.team_id))!;
      const period =
        current.subscription_status === "trialing"
          ? "trial"
          : new Date().toISOString().slice(0, 7);
      await c.query(
        "INSERT INTO intake_quota(team_id,period,draft_limit) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [tenant.team_id, period, period === "trial" ? 20 : 300],
      );
      if (
        !(
          await c.query(
            "UPDATE intake_quota SET used=used+$3 WHERE team_id=$1 AND period=$2 AND used+$3<=draft_limit RETURNING used",
            [tenant.team_id, period, mail.files.length],
          )
        ).rowCount
      )
        throw new IntakeError("Draft allowance exhausted.", 429);
      const ids: string[] = [];
      for (const file of mail.files) {
        const item = (
          await c.query(
            `INSERT INTO intake_items(team_id,tenant_id,filename,mime,status,target_book_id,target_book_name,created_by,source,source_metadata,draft_title) VALUES($1,$2,$3,$4,'queued',$5,$6,$7,'email',$8,$9) RETURNING id`,
            [
              tenant.team_id,
              tenant.id,
              file.filename,
              "application/octet-stream",
              book.id,
              book.name,
              actor.user_id,
              JSON.stringify({
                from: mail.from,
                subject: mail.subject,
                received_at: mail.received_at,
              }),
              mail.subject.slice(0, 250),
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO intake_email_files(item_id,content) VALUES($1,$2)",
          [item.id, file.content],
        );
        ids.push(item.id);
      }
      await c.query(
        "UPDATE intake_messages SET item_ids=$2 WHERE message_id=$1",
        [mail.message_id, ids],
      );
      return ids;
    });
  } catch (error) {
    if (error instanceof IntakeError && error.status === 403)
      await db.query(
        "INSERT INTO events(name,team_id) VALUES('inbound_rejected',$1)",
        [tenant.team_id],
      );
    throw error;
  }
}
