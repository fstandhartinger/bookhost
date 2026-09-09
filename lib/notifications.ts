import type { Queryable } from "./billing";
import { billingNotice, type BillingState } from "./trial";
export type NoticeMail = (email: string, text: string) => Promise<unknown>;
export async function generateNotifications(
  db: Queryable,
  now = new Date(),
  send?: NoticeMail,
) {
  const { rows } =
    await db.query(`SELECT s.*,t.owner_user_id,u.email,n.desired_state FROM teams t
    JOIN users u ON u.id=t.owner_user_id
    JOIN LATERAL (SELECT * FROM subscriptions WHERE team_id=t.id ORDER BY updated_at DESC LIMIT 1) s ON true
    LEFT JOIN tenants n ON n.team_id=t.id`);
  let created = 0;
  for (const row of rows) {
    const s = row as BillingState;
    const notice = billingNotice(s, now);
    if (!notice || ["trial", "active"].includes(notice.kind)) continue;
    const end =
      notice.kind === "payment_failed" ? s.current_period_end : s.trial_end;
    const period = `${s.stripe_subscription_id}:${end ? new Date(end).toISOString() : "unknown"}`;
    const result = await db.query(
      `INSERT INTO notifications(user_id,kind,period,payload,created_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,kind,period) DO NOTHING RETURNING id`,
      [
        row.owner_user_id,
        notice.kind,
        period,
        JSON.stringify({ text: notice.text, href: "/app/billing" }),
        now,
      ],
    );
    if (!result.rowCount) continue;
    created++;
    if (send) {
      try {
        await send(row.email, notice.text);
      } catch {
        console.error("Billing notice email failed; in-app notice retained");
      }
    }
  }
  return created;
}
export async function markNoticeRead(
  db: Queryable,
  userId: string,
  id: string,
) {
  await db.query(
    "UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
}
