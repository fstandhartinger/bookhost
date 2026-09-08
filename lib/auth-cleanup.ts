import { db } from "./db";
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
