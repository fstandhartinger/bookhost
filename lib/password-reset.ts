import { randomBytes } from "node:crypto";
import { createTransport } from "nodemailer";
import { db, transaction } from "./db";
import { baseUrl } from "./config";
import { digest } from "./security";
import { hashPassword } from "./password";
export async function sendPasswordReset(email: string) {
  const user = (
    await db.query("SELECT id FROM users WHERE lower(email)=$1", [email])
  ).rows[0];
  if (!user) return;
  const token = randomBytes(32).toString("hex");
  await db.query(
    "INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
    [digest(token), user.id],
  );
  const transport = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to: email,
    subject: "Reset your Wissen password",
    text: `Reset your password: ${baseUrl()}/login/reset?token=${token}\nThis link expires in 30 minutes and can only be used once. If you did not request it, ignore this email.`,
  });
}
export async function resetPassword(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const hash = await hashPassword(password);
  return transaction(async (client) => {
    const reset = (
      await client.query(
        "SELECT user_id FROM password_reset_tokens WHERE token_hash=$1",
        [digest(token)],
      )
    ).rows[0];
    if (!reset) return false;
    // Same lock order as password changes; serialize resets for this user.
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      reset.user_id,
    ]);
    const consumed = await client.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id",
      [digest(token)],
    );
    if (!consumed.rowCount) return false;
    await client.query(
      "UPDATE users SET password_hash=$2,password_set_at=now(),session_version=session_version+1 WHERE id=$1",
      [reset.user_id, hash],
    );
    await client.query(
      "UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
      [reset.user_id],
    );
    return true;
  });
}
