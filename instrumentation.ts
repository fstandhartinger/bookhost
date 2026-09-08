export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startAuthCleanup } = await import("./lib/auth-cleanup");
    startAuthCleanup();
    const { startIntakeCleanup } = await import("./lib/intake/jobs");
    startIntakeCleanup();
  }
}
