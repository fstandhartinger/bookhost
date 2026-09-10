import { inboundEmailEnabled, requireInboundEmail } from "./inbound-enabled";
import { db, transaction } from "@/lib/db";
import { acquireSlot } from "./slots";
import { enqueue } from "./jobs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Serialize the short scheduler decision across processes so two claims cannot
// both observe no running item for the same team. No file or network I/O here.
export async function claimEmail() {
  if (!inboundEmailEnabled()) return;
  return transaction(async (c) => {
    requireInboundEmail("claim");
    await c.query("SELECT pg_advisory_xact_lock(782341, 1)");
    return (
      await c.query(`WITH candidate AS MATERIALIZED (
        SELECT i.id FROM intake_items i
        WHERE i.source='email' AND i.status='queued'
          AND EXISTS(SELECT 1 FROM intake_email_files f WHERE f.item_id=i.id)
          AND NOT EXISTS(SELECT 1 FROM intake_items running WHERE running.team_id=i.team_id AND running.status='drafting')
        ORDER BY i.created_at,i.id FOR UPDATE OF i SKIP LOCKED LIMIT 1
      )
      UPDATE intake_items SET status='drafting',updated_at=now()
      FROM candidate WHERE intake_items.id=candidate.id AND intake_items.status='queued'
      RETURNING intake_items.id,team_id,created_by,tenant_id,filename,
        (SELECT content FROM intake_email_files WHERE item_id=intake_items.id) AS content`)
    ).rows[0];
  });
}
let draining = false;
export async function drainEmail() {
  if (!inboundEmailEnabled() || draining) return;
  draining = true;
  try {
    for (let n = 0; n < 2 && inboundEmailEnabled(); n++) {
      const row = await claimEmail();
      if (!row) {
        break;
      }
      const release = acquireSlot(row.team_id);
      if (!release) {
        await db.query(
          "UPDATE intake_items SET status='queued',updated_at=now() WHERE id=$1 AND status='drafting'",
          [row.id],
        );
        break;
      }
      let dir: string | undefined;
      try {
        dir = await mkdtemp(join(tmpdir(), "wissen-intake-"));
        const path = join(dir, "source");
        await writeFile(path, row.content, { mode: 0o600 });
        requireInboundEmail("dispatch");
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
          release,
          true,
          () => requireInboundEmail("processing"),
        );
      } catch {
        try {
          await db.query(
            "UPDATE intake_items SET status='queued',updated_at=now() WHERE id=$1 AND status='drafting'",
            [row.id],
          );
          if (dir) await rm(dir, { recursive: true, force: true });
        } finally {
          release();
        }
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
  if (!inboundEmailEnabled() || state.emailTimer) return;
  state.emailTimer = setInterval(() => {
    void drainEmail().catch(() =>
      console.error("Email intake dispatch failed"),
    );
  }, 5000);
  state.emailTimer.unref();
}
