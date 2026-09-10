import type { Queryable } from "./billing";
import { billingNotice, billingDate, type BillingState } from "./trial";
export type NoticeMail = (
  email: string,
  text: string,
  notice: { kind: string; href: string },
) => Promise<unknown>;
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
        OR (n.kind='payment_failed' AND s.status IN ('past_due','unpaid'))
        OR (n.kind IN ('activation_workspace','activation_first_page')
          AND s.status='trialing' AND s.trial_end>$1
          AND n.period=s.stripe_subscription_id||':'||to_char(s.trial_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          AND NOT EXISTS (SELECT 1 FROM team_onboarding o WHERE o.team_id=t.id
            AND o.step=CASE n.kind WHEN 'activation_workspace' THEN 'workspace' ELSE 'publish' END)
          AND (n.kind='activation_workspace' OR (
            EXISTS (SELECT 1 FROM team_onboarding o WHERE o.team_id=t.id AND o.step='workspace')
            AND EXISTS (SELECT 1 FROM tenants w WHERE w.team_id=t.id))))))`,
    [now],
  );
  const { rows } = await db.query(
    `SELECT s.*,t.owner_user_id,u.email,n.desired_state,t.created_at AS team_created_at,
      n.team_id IS NOT NULL AS workspace_exists,
      EXISTS (SELECT 1 FROM team_onboarding o WHERE o.team_id=t.id AND o.step='workspace') AS workspace_done,
      EXISTS (SELECT 1 FROM team_onboarding o WHERE o.team_id=t.id AND o.step='publish') AS publish_done
    FROM (SELECT DISTINCT team_id FROM subscriptions WHERE trial_end BETWEEN $1::timestamptz-interval '7 days' AND $1::timestamptz+interval '3 days'
      UNION SELECT team_id FROM subscriptions WHERE status IN ('past_due','unpaid')
      OR (status='trialing' AND trial_end>$1)) candidates
    JOIN effective_subscriptions s ON s.team_id=candidates.team_id
    JOIN teams t ON t.id=s.team_id JOIN users u ON u.id=t.owner_user_id
    LEFT JOIN tenants n ON n.team_id=t.id`,
    [now],
  );
  let created = 0;
  for (const row of rows) {
    const s = row as BillingState;
    // Use the persisted onboarding history, including steps completed before this run.
    const age = now.getTime() - new Date(row.team_created_at).getTime();
    if (s.status === "trialing" && s.trial_end && new Date(s.trial_end) > now) {
      const activation =
        !row.workspace_done && age >= 24 * 3600_000
          ? {
              kind: "activation_workspace",
              href: "/app",
              text: "Your BookHost trial is running, but your workspace isn't created yet. Choose your workspace address — it is ready in about five minutes.",
            }
          : row.workspace_done &&
              row.workspace_exists &&
              !row.publish_done &&
              age >= 72 * 3600_000
            ? {
                kind: "activation_first_page",
                href: "/app/intake",
                text: "Your workspace is ready. Upload one document and approve the suggested page — most teams do this in under five minutes.",
              }
            : null;
      if (activation) {
        const period = `${s.stripe_subscription_id}:${new Date(s.trial_end).toISOString()}`;
        const result = await db.query(
          `INSERT INTO notifications(user_id,kind,period,payload,created_at,subscription_id)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,kind,period) DO NOTHING RETURNING id`,
          [
            row.owner_user_id,
            activation.kind,
            period,
            JSON.stringify({ text: activation.text, href: activation.href }),
            now,
            s.stripe_subscription_id,
          ],
        );
        created += result.rowCount || 0;
      }
    }
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
      await db.query(`SELECT n.id,n.kind,n.payload,u.email FROM notifications n JOIN users u ON u.id=n.user_id
      WHERE n.resolved_at IS NULL AND n.mail_status<>'sent' ORDER BY n.attempts,n.created_at LIMIT 300`);
    let index = 0;
    const results: { id: string; status: string }[] = [];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (index < pending.rows.length) {
          const row = pending.rows[index++];
          let status = "sent";
          try {
            await send(row.email, row.payload.text, {
              kind: row.kind,
              href: row.payload.href,
            });
          } catch {
            status = "mail_failed";
            console.error("Workspace notice email failed; retry next run");
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
