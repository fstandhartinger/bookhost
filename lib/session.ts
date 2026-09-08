import type { JWT } from "next-auth/jwt";
import { db } from "./db";

// userId is supplied only for verified providers. Credentials pass their
// authenticated version in token so a concurrent password change rejects it.
export async function sessionToken(
  token: JWT,
  userId?: string,
): Promise<JWT | null> {
  if (userId) {
    const result = await db.query(
      `UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),
       session_version=session_version+1 WHERE id=$1 RETURNING session_version`,
      [userId],
    );
    if (!result.rows[0]) return null;
    token.sub = userId;
    token.session_version = result.rows[0].session_version;
  }
  if (!token.sub) return null;
  const result = await db.query(
    "SELECT session_version FROM users WHERE id=$1",
    [token.sub],
  );
  if (
    !result.rows[0] ||
    token.session_version !== result.rows[0].session_version
  )
    return null;
  return token;
}
