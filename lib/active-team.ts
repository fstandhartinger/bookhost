import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ACTIVE_TEAM_COOKIE } from "@/lib/join-context";

// Which team is this person looking at right now?
//
// The dashboard and the document intake page used to answer this separately.
// They drifted apart twice within two days: once the intake page showed another
// team's workspace and quota, once a link from the dashboard led to a different
// team than the one on screen. The precedence and the tie-break live here so a
// third page cannot invent a third answer.
//
// Precedence: an explicit ?team= wins over the stored active team, and both win
// over the newest membership. Equal timestamps are broken by team id, because
// migration 017 backfilled memberships.created_at with now() and older rows
// therefore share a timestamp.
export const MEMBERSHIP_ORDER = "ORDER BY m.created_at DESC,m.team_id";

export async function activeTeamId(
  userId: string,
  explicit?: string,
  database: Pick<typeof db, "query"> = db,
): Promise<string | null> {
  const stored = (await cookies()).get(ACTIVE_TEAM_COOKIE)?.value;
  const wanted = (explicit || stored || "").trim();
  const rows = (
    await database.query(
      `SELECT m.team_id FROM memberships m WHERE m.user_id=$1 ${MEMBERSHIP_ORDER}`,
      [userId],
    )
  ).rows as { team_id: string }[];
  if (!rows.length) return null;
  return (rows.find((row) => row.team_id === wanted) || rows[0]).team_id;
}
