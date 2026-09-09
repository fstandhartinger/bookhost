import type { Queryable } from "./billing";
import { billingNotice, billingDate, type BillingState } from "./trial";
export type NoticeMail = (email: string, text: string) => Promise<unknown>;
// Caller owns a dedicated connection and transaction. Transaction-scoped locks
// are safe behind PgBouncer and release automatically even after process death.
export async function generateNotifications(
  db: Queryable,
  now = new Date(),
  send?: NoticeMail,
) {
  const lock = await db.query(
    "SELECT pg_try_advisory_xact_lock(827492015) AS acquired",
  );
  if (!lock.rows[0]?.acquired) return 0;
  await db.query(
    `UPDATE tenants n SET desired_state='suspended',updated_at=$1
    FROM effective_subscriptions s WHERE s.team_id=n.team_id AND s.status='trialing'
    AND s.trial_end <= $1 AND n.desired_state<>'suspended'`,
    [now],
  );
  await db.query(
    `UPDATE notifications n SET resolved_at=$1 FROM teams t
    WHERE n.user_id=t.owner_user_id AND n.resolved_at IS NULL AND NOT EXISTS (
      SELECT 1 FROM effective_subscriptions s WHERE s.team_id=t.id
      AND s.stripe_subscription_id=COALESCE(n.subscription_id,split_part(n.period,':',1))
      AND ((n.kind LIKE 'trial_ending%' AND s.status='trialing' AND NOT s.has_payment_method AND s.trial_end>$1
        AND n.period=s.stripe_subscription_id||':'||to_char(s.trial_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        OR (n.kind='trial_ended' AND s.status IN ('trialing','canceled') AND s.trial_end<=$1)
        OR (n.kind='payment_failed' AND s.status IN ('past_due','unpaid'))))`,
    [now],
  );
  const { rows } = await db.query(
    `SELECT s.*,t.owner_user_id,u.email,n.desired_state
    FROM (SELECT DISTINCT team_id FROM subscriptions WHERE trial_end BETWEEN $1::timestamptz-interval '7 days' AND $1::timestamptz+interval '3 days'
      UNION SELECT team_id FROM subscriptions WHERE status IN ('past_due','unpaid')) candidates
    JOIN effective_subscriptions s ON s.team_id=candidates.team_id
    JOIN teams t ON t.id=s.team_id JOIN users u ON u.id=t.owner_user_id
    LEFT JOIN tenants n ON n.team_id=t.id`,
    [now],
  );
  let created = 0;
  for (const row of rows) {
    const s = row as BillingState;
    let notice = billingNotice(s, now);
    if (
      s.status === "canceled" &&
      s.trial_end &&
      s.current_period_end &&
      new Date(s.trial_end) <= now &&
      new Date(s.current_period_end).getTime() <=
        new Date(s.trial_end).getTime()
    )
      notice = {
        urgent: true,
        kind: "trial_ended",
        action: "checkout",
        text: "Your trial ended. Resume workspace with a paid subscription from your dashboard. No new free trial applies.",
      };
    if (
      !notice ||
      ![
        "trial_ending_3d",
        "trial_ending_1d",
        "trial_ended",
        "payment_failed",
      ].includes(notice.kind) ||
      (notice.kind.startsWith("trial_ending") && s.has_payment_method)
    )
      continue;
    const end =
      notice.kind === "payment_failed" ? s.current_period_end : s.trial_end;
    const period = `${s.stripe_subscription_id}:${end ? new Date(end).toISOString() : "unknown"}`;
    const text = notice.kind.startsWith("trial_ending")
      ? `Your free trial ends on ${billingDate(s.trial_end!)} UTC. Add a payment method to keep your workspace.`
      : notice.text;
    const result = await db.query(
      `INSERT INTO notifications(user_id,kind,period,payload,created_at,subscription_id)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,kind,period) DO NOTHING RETURNING id`,
      [
        row.owner_user_id,
        notice.kind,
        period,
        JSON.stringify({ text, href: "/app/billing" }),
        now,
        s.stripe_subscription_id,
      ],
    );
    created += result.rowCount || 0;
  }
  if (send) {
    const pending =
      await db.query(`SELECT n.id,n.payload,u.email FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.resolved_at IS NULL AND n.mail_status<>'sent' ORDER BY n.attempts,n.created_at LIMIT 300`);
    let index = 0;
    const results: { id: string; status: string }[] = [];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (index < pending.rows.length) {
          const row = pending.rows[index++];
          let status = "sent";
          try {
            await send(row.email, row.payload.text);
          } catch {
            status = "mail_failed";
            console.error("Billing notice email failed; retry next run");
          }
          results.push({ id: row.id, status });
        }
      }),
    );
    for (const result of results)
      await db.query(
        "UPDATE notifications SET mail_status=$2,attempts=attempts+1 WHERE id=$1",
        [result.id, result.status],
      );
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
