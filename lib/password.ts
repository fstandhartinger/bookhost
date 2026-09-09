import argon2 from "argon2";
import { CredentialsSignin } from "next-auth";
import { db, transaction } from "./db";
import { clientIp, digest, freshAuthentication, rateLimit } from "./security";

const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const hashPassword = (password: string) =>
  argon2.hash(password, options);
// Same Argon2 work for missing users and users without a password.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  return (dummyHash ??= hashPassword(
    "dummy-password-never-used-for-authentication",
  ).catch((error) => {
    dummyHash = undefined;
    throw error;
  }));
}
export async function verifyPassword(hash: string | null, password: string) {
  const valid = await argon2.verify(hash || (await getDummyHash()), password);
  return Boolean(hash) && valid;
}
export class PasswordRateLimit extends CredentialsSignin {
  code = "rate_limited";
}
import { normalizeEmail } from "./email";
import { notifyPasswordChanged } from "./password-mail";
export { normalizeEmail } from "./email";
export function passwordRateKey(email: string, request: Request) {
  const ip = clientIp(request);
  if (!ip) throw new Error("Missing client IP");
  return "password:" + digest(email + ":" + ip);
}
export async function consumePasswordAttempt(email: string, request: Request) {
  if (
    !(await rateLimit(passwordRateKey(email, request), 10, 900)) ||
    !(await rateLimit("password-user:" + digest(email), 30, 900))
  )
    throw new PasswordRateLimit();
}
export async function authorizePassword(
  credentials: Partial<Record<"email" | "password", unknown>>,
  request: Request,
) {
  const email = normalizeEmail(credentials.email);
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return null;
  await consumePasswordAttempt(email, request);
  const password =
    typeof credentials.password === "string" ? credentials.password : "";
  if (password.length > 1024) return null;
  const user = (
    await db.query(
      "SELECT id,email,name,password_hash,session_version FROM users WHERE lower(email)=$1",
      [email],
    )
  ).rows[0];
  if (!(await verifyPassword(user?.password_hash || null, password)))
    return null;
  await db.query(
    "UPDATE rate_limits SET hits=GREATEST(hits-1,0) WHERE key=$1",
    ["password-user:" + digest(email)],
  );
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    session_version: user.session_version,
  };
}
export function validNewPassword(password: string, confirmation: string) {
  return (
    password.length >= 10 &&
    password.length <= 1024 &&
    password === confirmation
  );
}
export async function changePassword(
  userId: string,
  password: string,
  oldPassword: string,
  authTime?: number,
) {
  const user = (
    await db.query(
      "SELECT password_hash,email_verified_at,session_version FROM users WHERE id=$1",
      [userId],
    )
  ).rows[0];
  if (
    !user ||
    (user.password_hash
      ? !(await verifyPassword(user.password_hash, oldPassword))
      : !user.email_verified_at && !freshAuthentication(authTime))
  )
    return null;
  const hash = await hashPassword(password);
  const result = await transaction(async (client) => {
    const updated = (
      await client.query(
        `UPDATE users SET password_hash=$2,password_set_at=now(),session_version=session_version+1 WHERE id=$1 AND password_hash IS NOT DISTINCT FROM $3 AND session_version=$4 RETURNING id,email,name,session_version`,
        [userId, hash, user.password_hash, user.session_version],
      )
    ).rows[0];
    if (!updated) return null;
    await client.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    return updated;
  });
  if (result) notifyPasswordChanged(result.email);
  return result;
}
