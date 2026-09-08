import type { Adapter, AdapterUser } from "next-auth/adapters";
import { normalizeEmail } from "./email";
import { db } from "./db";
function user(row: Record<string, unknown>): AdapterUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name as string | null,
    image: row.image as string | null,
    emailVerified: row.email_verified as Date | null,
  };
}
export const adapter: Adapter = {
  async createUser(data) {
    const r = await db.query(
      "INSERT INTO users(email,name,email_verified,image) VALUES($1,$2,$3,$4) RETURNING *",
      [normalizeEmail(data.email), data.name, data.emailVerified, data.image],
    );
    return user(r.rows[0]);
  },
  async getUser(id) {
    const r = await db.query("SELECT * FROM users WHERE id=$1", [id]);
    return r.rows[0] ? user(r.rows[0]) : null;
  },
  async getUserByEmail(email) {
    const r = await db.query("SELECT * FROM users WHERE lower(email)=$1", [
      normalizeEmail(email),
    ]);
    return r.rows[0] ? user(r.rows[0]) : null;
  },
  async getUserByAccount({ provider, providerAccountId }) {
    const r = await db.query(
      "SELECT u.* FROM users u JOIN accounts a ON a.user_id=u.id WHERE a.provider=$1 AND a.provider_account_id=$2",
      [provider, providerAccountId],
    );
    return r.rows[0] ? user(r.rows[0]) : null;
  },
  async updateUser(data) {
    const r = await db.query(
      "UPDATE users SET name=COALESCE($2,name),email_verified=COALESCE($3,email_verified),image=COALESCE($4,image) WHERE id=$1 RETURNING *",
      [data.id, data.name, data.emailVerified, data.image],
    );
    return user(r.rows[0]);
  },
  async linkAccount(a) {
    await db.query(
      "INSERT INTO accounts(user_id,type,provider,provider_account_id,refresh_token,access_token,expires_at,token_type,scope,id_token,session_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        a.userId,
        a.type,
        a.provider,
        a.providerAccountId,
        a.refresh_token,
        a.access_token,
        a.expires_at,
        a.token_type,
        a.scope,
        a.id_token,
        a.session_state,
      ],
    );
  },
  async createVerificationToken(token) {
    await db.query("DELETE FROM verification_tokens WHERE expires < now()");
    await db.query(
      "INSERT INTO verification_tokens(identifier,token,expires) VALUES($1,$2,$3)",
      [token.identifier, token.token, token.expires],
    );
    return token;
  },
  async useVerificationToken({ identifier, token }) {
    const r = await db.query(
      "DELETE FROM verification_tokens WHERE identifier=$1 AND token=$2 RETURNING *",
      [identifier, token],
    );
    return r.rows[0] || null;
  },
};
