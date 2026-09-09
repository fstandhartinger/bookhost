import { generateNotifications } from "./notifications";
import { mailTransport } from "./password-mail";
import { baseUrl } from "./config";
import { db, transaction } from "./db";
const state = globalThis as typeof globalThis & {
  authCleanupTimer?: NodeJS.Timeout;
};
export function startAuthCleanup() {
  if (state.authCleanupTimer) return;
  let running = false;
  const clean = async () => {
    if (running) return;
    running = true;
    try {
      await db.query(
        "DELETE FROM password_reset_tokens WHERE expires_at<now()",
      );
      await db.query("DELETE FROM rate_limits WHERE expires_at<now()");
      await db.query(
        "DELETE FROM page_views WHERE ts<now()-interval '90 days'",
      );
      await db.query("DELETE FROM events WHERE ts<now()-interval '90 days'");
      await transaction(async (client) =>
        generateNotifications(
          client,
          new Date(),
          process.env.SMTP_HOST
            ? async (email, text) => {
                await mailTransport().sendMail({
                  from:
                    process.env.SMTP_FROM ||
                    "BookHost <noreply@mail.mintapis.com>",
                  to: email,
                  subject: "Your BookHost workspace: billing notice",
                  text: `${text}\n\nManage billing: ${baseUrl()}/app/billing`,
                });
              }
            : undefined,
        ),
      );
    } catch {
      console.error("Authentication cleanup failed");
    } finally {
      running = false;
    }
  };
  state.authCleanupTimer = setInterval(() => {
    void clean();
  }, 3600_000);
  state.authCleanupTimer.unref();
  void clean();
}
