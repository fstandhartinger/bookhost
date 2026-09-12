import type { Pool, PoolClient } from "pg";
import { QUOTAS } from "@/lib/quotas";
import { db } from "@/lib/db";
import { IntakeError } from "@/lib/intake/access";

export async function chatQuota(
  team: string,
  status: string,
  reserve = false,
  connection: Pool | PoolClient = db,
) {
  const period =
    status === "trialing" ? "trial" : new Date().toISOString().slice(0, 7);
  const limit =
    status === "trialing"
      ? QUOTAS.trialChatQuestions
      : QUOTAS.monthlyChatQuestions;
  await connection.query(
    "INSERT INTO chat_quota(team_id,period,question_limit) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [team, period, limit],
  );
  const result = reserve
    ? await connection.query(
        "UPDATE chat_quota SET used=used+1 WHERE team_id=$1 AND period=$2 AND used<question_limit RETURNING used,question_limit",
        [team, period],
      )
    : await connection.query(
        "SELECT used,question_limit FROM chat_quota WHERE team_id=$1 AND period=$2",
        [team, period],
      );
  if (!result.rowCount)
    throw new IntakeError(
      "Question allowance exhausted. Open the billing portal from Your workspace to manage your subscription.",
      402,
    );
  return {
    remaining: Math.max(0, result.rows[0].question_limit - result.rows[0].used),
    limit: result.rows[0].question_limit,
    period,
  };
}

/** Only a failed answer returns a reserved place; a refusal is a completed answer. */
export async function refundChat(
  team: string,
  period: string,
  connection: Pool | PoolClient = db,
) {
  await connection.query(
    "UPDATE chat_quota SET used=GREATEST(used-1,0) WHERE team_id=$1 AND period=$2",
    [team, period],
  );
}
