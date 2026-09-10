import { InboundEmailDisabledError } from "./inbound-enabled";
import { db } from "@/lib/db";
import { workspace } from "./access";
import { extractFile } from "./extract";
import { generateDraft } from "./draft";
export function enqueue(
  id: string,
  user: string,
  tenant: string,
  path: string,
  filename: string,
  cleanup: () => Promise<void>,
  release: () => void,
  alreadyClaimed = false,
  beforeProcessing?: () => void,
) {
  setImmediate(() => {
    void (async () => {
      try {
        beforeProcessing?.();
        await workspace(user, tenant);
        const claimed = alreadyClaimed
          ? { rowCount: 1 }
          : await db.query(
              "UPDATE intake_items SET status='drafting',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id",
              [id],
            );
        if (!claimed.rowCount) return;
        const source = await extractFile(path, filename);
        await db.query(
          "UPDATE intake_items SET extracted_text=$2,mime=$3 WHERE id=$1",
          [id, source.text, source.mime],
        );
        beforeProcessing?.();
        await workspace(user, tenant);
        const draft = await generateDraft(source.text);
        beforeProcessing?.();
        await workspace(user, tenant);
        await db.query(
          "UPDATE intake_items SET status='draft',draft_title=CASE WHEN source='email' AND length(trim(draft_title))>0 THEN draft_title ELSE $2 END,draft_html=$3,draft_tags=$4,updated_at=now() WHERE id=$1 AND status='drafting'",
          [id, draft.title, draft.html, JSON.stringify(draft.tags)],
        );
      } catch (error) {
        if (error instanceof InboundEmailDisabledError) {
          // Pausing the receiver must retain the durable email source for resume.
          await db.query(
            "UPDATE intake_items SET status='queued',updated_at=now() WHERE id=$1 AND source='email' AND status='drafting'",
            [id],
          );
          return;
        }
        await db
          .query(
            "UPDATE intake_items SET status='failed',error='Draft could not be created. Check the file and workspace subscription, then try again.',updated_at=now() WHERE id=$1 AND status IN ('queued','drafting')",
            [id],
          )
          .catch(() => {});
      } finally {
        try {
          await cleanup();
        } finally {
          release();
        }
      }
    })().catch(() => console.error("Intake job cleanup failed"));
  });
}
export async function recoverIntake() {
  const { readdir, lstat, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  for (const name of await readdir(tmpdir())) {
    if (!/^wissen-intake-[a-zA-Z0-9]+$/.test(name)) continue;
    const path = join(tmpdir(), name);
    const stat = await lstat(path).catch(() => null);
    if (
      stat?.isDirectory() &&
      !stat.isSymbolicLink() &&
      Date.now() - stat.mtimeMs > 1800000
    )
      await rm(path, { recursive: true, force: true });
  }
  await db.query(
    "UPDATE intake_items SET status='failed',error='Processing was interrupted. Retry publication for a reviewed draft, or upload the source again.',updated_at=now() WHERE NOT (source='email' AND status='queued') AND status IN ('uploaded','queued','drafting','approved') AND updated_at<now()-interval '10 minutes'",
  );
  await db.query(
    "UPDATE intake_items SET status='failed',error='Queued email source is missing. Ask the sender to submit it again.',updated_at=now() WHERE source='email' AND status='queued' AND updated_at<now()-interval '30 minutes' AND NOT EXISTS(SELECT 1 FROM intake_email_files f WHERE f.item_id=intake_items.id)",
  );
  await db.query(
    "DELETE FROM intake_messages WHERE created_at<now()-interval '90 days'",
  );
  await db.query(
    "DELETE FROM intake_email_files WHERE item_id IN (SELECT id FROM intake_items WHERE status NOT IN ('queued','drafting'))",
  );
  await db.query(
    "DELETE FROM intake_items WHERE created_at<now()-interval '30 days'",
  );
}
const globalJobs = globalThis as unknown as {
  intakeTimer?: ReturnType<typeof setInterval>;
};
export function startIntakeCleanup() {
  if (globalJobs.intakeTimer) return;
  void recoverIntake().catch(() => console.error("Intake recovery failed"));
  globalJobs.intakeTimer = setInterval(() => {
    void recoverIntake().catch(() => console.error("Intake cleanup failed"));
  }, 3600000);
  globalJobs.intakeTimer.unref();
}
