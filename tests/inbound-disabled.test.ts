import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  transaction: vi.fn(async () => undefined),
}));
vi.mock("@/lib/security", () => ({
  rateLimit: vi.fn(async () => true),
  digest: vi.fn(),
  clientIp: vi.fn(),
}));
vi.mock("@/lib/intake/jobs", () => ({ enqueue: vi.fn() }));
import { db, transaction } from "@/lib/db";
import { POST } from "@/app/api/intake/inbound/route";
import { acceptEmail } from "@/lib/intake/inbound";
import { parseEmail } from "@/lib/intake/email";
import {
  claimEmail,
  drainEmail,
  startEmailQueue,
} from "@/lib/intake/email-jobs";
import { enqueue } from "@/lib/intake/jobs";
const raw = JSON.stringify({
  message_id: "disabled",
  to: ["demo@intake.bookhost.co"],
  from: { address: "member@example.com" },
  subject: "Private",
  text: "x".repeat(201),
  attachments: [],
  received_at: new Date().toISOString(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INBOUND_WEBHOOK_SECRET", "test-only");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it.each([undefined, "false", "TRUE", "1", ""])(
  "rejects signed mail while flag is %s before reading or storing",
  async (flag) => {
    vi.stubEnv("INBOUND_EMAIL_ENABLED", flag);
    const t = Math.floor(Date.now() / 1000);
    const signature = `t=${t},v1=${createHmac("sha256", "test-only")
      .update(t + "." + raw)
      .digest("hex")}`;
    const request = new Request("http://localhost/api/intake/inbound", {
      method: "POST",
      body: raw,
      headers: {
        "content-length": String(Buffer.byteLength(raw)),
        "x-wissen-signature": signature,
      },
    });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Inbound email intake is disabled.",
    });
    expect(request.bodyUsed).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "inbound_email_disabled",
        phase: "webhook",
      }),
    );
  },
);
it("blocks direct admission before database or upstream work", async () => {
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
  await expect(acceptEmail(parseEmail(Buffer.from(raw)))).rejects.toMatchObject(
    { status: 403, message: "Inbound email intake is disabled." },
  );
  expect(db.query).not.toHaveBeenCalled();
});
it("does not claim or drain existing queued messages when disabled", async () => {
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
  await claimEmail();
  await drainEmail();
  expect(transaction).not.toHaveBeenCalled();
  expect(db.query).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});
it("does not start a queue timer while disabled", () => {
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
  vi.useFakeTimers();
  startEmailQueue();
  expect(vi.getTimerCount()).toBe(0);
});
it("rechecks the switch when a queue transaction finally acquires a connection", async () => {
  vi.stubEnv("INBOUND_EMAIL_ENABLED", "true");
  const query = vi.fn();
  vi.mocked(transaction).mockImplementationOnce(async (callback) => {
    vi.stubEnv("INBOUND_EMAIL_ENABLED", "false");
    return callback({ query } as never);
  });
  await expect(claimEmail()).rejects.toMatchObject({ status: 403 });
  expect(query).not.toHaveBeenCalled();
});
