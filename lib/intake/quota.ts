import type { Pool, PoolClient } from "pg";
import { QUOTAS } from "@/lib/quotas";
import { db } from "@/lib/db";
import { IntakeError } from "./access";
export async function quota(
  team: string,
  status: string,
  reserve = false,
  connection: Pool | PoolClient = db,
) {
  const period =
    status === "trialing" ? "trial" : new Date().toISOString().slice(0, 7);
  const limit =
    status === "trialing" ? QUOTAS.trialDrafts : QUOTAS.monthlyDrafts;
  await connection.query(
    "INSERT INTO intake_quota(team_id,period,draft_limit) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [team, period, limit],
  );
  const result = reserve
    ? await connection.query(
        "UPDATE intake_quota SET used=used+1 WHERE team_id=$1 AND period=$2 AND used<draft_limit RETURNING used,draft_limit",
        [team, period],
      )
    : await connection.query(
        "SELECT used,draft_limit FROM intake_quota WHERE team_id=$1 AND period=$2",
        [team, period],
      );
  if (!result.rowCount)
    throw new IntakeError(
      "Draft allowance exhausted. Open the billing portal from Your workspace to manage your subscription.",
      402,
    );
  return {
    remaining: Math.max(0, result.rows[0].draft_limit - result.rows[0].used),
    limit: result.rows[0].draft_limit,
    period,
  };
}
