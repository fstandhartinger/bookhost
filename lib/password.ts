import argon2 from "argon2";
import { CredentialsSignin } from "next-auth";
import { db, transaction } from "./db";
import { digest, rateLimit } from "./security";

const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const hashPassword = (password: string) =>
  argon2.hash(password, options);
// Same Argon2 work for missing users and users without a password.
const dummyHash = hashPassword("dummy-password-never-used-for-authentication");
export async function verifyPassword(hash: string | null, password: string) {
  const valid = await argon2.verify(hash || (await dummyHash), password);
  return Boolean(hash) && valid;
}
export class PasswordRateLimit extends CredentialsSignin {
  code = "rate_limited";
}
export const normalizeEmail = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
export function passwordRateKey(email: string, request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "unknown";
  return "password:" + digest(email + ":" + ip);
}
export async function authorizePassword(
  credentials: Partial<Record<"email" | "password", unknown>>,
  request: Request,
) {
  const email = normalizeEmail(credentials.email);
  if (!(await rateLimit(passwordRateKey(email, request), 10, 900)))
    throw new PasswordRateLimit();
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
) {
  const hash = await hashPassword(password);
  return transaction(async (client) => {
    const user = (
      await client.query(
        "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (
      !user ||
      (user.password_hash &&
        !(await verifyPassword(user.password_hash, oldPassword)))
    )
      return null;
    const updated = (
      await client.query(
        `UPDATE users SET password_hash=$2,password_set_at=now(),session_version=session_version+1 WHERE id=$1 RETURNING id,email,name,session_version`,
        [userId, hash],
      )
    ).rows[0];
    await client.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [userId],
    );
    return updated;
  });
}
