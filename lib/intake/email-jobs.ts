import { db } from "@/lib/db";
import { acquireSlot } from "./slots";
import { enqueue } from "./jobs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let draining = false;
export async function drainEmail() {
  if (draining) return;
  draining = true;
  try {
    const rows = (
      await db.query(
        "SELECT i.id,i.created_by,i.tenant_id,i.filename,f.content FROM intake_items i JOIN intake_email_files f ON f.item_id=i.id WHERE i.status='queued' ORDER BY i.created_at LIMIT 2",
      )
    ).rows;
    for (const row of rows) {
      const release = acquireSlot();
      if (!release) break;
      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), "wissen-intake-"));
        const path = join(dir, "source");
        await writeFile(path, row.content, { mode: 0o600 });
        const folder = dir;
        enqueue(
          row.id,
          row.created_by,
          row.tenant_id,
          path,
          row.filename,
          async () => {
            await rm(folder, { recursive: true, force: true });
            await db.query(
              "DELETE FROM intake_email_files WHERE item_id=$1 AND EXISTS(SELECT 1 FROM intake_items WHERE id=$1 AND status NOT IN ('queued','drafting'))",
              [row.id],
            );
          },
          () => {
            release();
          },
        );
      } catch {
        if (dir) await rm(dir, { recursive: true, force: true });
        release();
      }
    }
  } finally {
    draining = false;
  }
}
const state = globalThis as unknown as {
  emailTimer?: ReturnType<typeof setInterval>;
};
export function startEmailQueue() {
  if (state.emailTimer) return;
  state.emailTimer = setInterval(() => {
    void drainEmail().catch(() =>
      console.error("Email intake dispatch failed"),
    );
  }, 5000);
  state.emailTimer.unref();
}
