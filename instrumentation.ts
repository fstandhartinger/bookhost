export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startAuthCleanup } = await import("./lib/auth-cleanup");
    startAuthCleanup();
    const { startIntakeCleanup } = await import("./lib/intake/jobs");
    startIntakeCleanup();
    const { startEmailQueue } = await import("./lib/intake/email-jobs");
    startEmailQueue();
    const { startWikiIndexRefresh } = await import("./lib/chat/wiki-index-jobs");
    startWikiIndexRefresh();
  }
}
