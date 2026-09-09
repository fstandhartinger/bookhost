import { createTransport } from "nodemailer";
import { smtpReady } from "./config";
export function mailTransport() {
  return createTransport({
    host: process.env.SMTP_HOST,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}
export function notifyPasswordChanged(email: string) {
  if (!smtpReady()) return;
  void Promise.resolve()
    .then(() =>
      mailTransport().sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject: "Your Wissen password was set or changed",
        text: "Your Wissen password was set or changed. If this was not you, reset your password immediately or contact info@productivity-boost.com.",
      }),
    )
    .catch(() => console.error("Password change notification failed"));
}
