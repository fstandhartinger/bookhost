import { afterEach, expect, it, vi } from "vitest";
vi.mock("../lib/notifications", () => ({
  generateNotifications: vi.fn(async () => 0),
  deliverNotifications: vi.fn(async () => 0),
}));
vi.mock("@/lib/db", () => ({
  transaction: async (fn: (c: object) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await fn({});
    } finally {
      inTransaction = false;
    }
  },
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("../lib/password-mail", () => ({
  mailTransport: () => ({ sendMail }),
}));
vi.mock("../lib/config", () => ({ baseUrl: () => "https://bookhost.example" }));
let inTransaction = false;
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
import {
  generateNotifications,
  deliverNotifications,
} from "../lib/notifications";
import { startAuthCleanup } from "../lib/auth-cleanup";
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (
    globalThis as typeof globalThis & { authCleanupTimer?: NodeJS.Timeout }
  ).authCleanupTimer;
});
it("commits generation before dispatch and only supplies transactional mail copy", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SMTP_HOST", "fixture.invalid");
  vi.stubEnv("SMTP_FROM", "fixture@example.invalid");
  vi.mocked(deliverNotifications).mockImplementation(async (_db, send) => {
    expect(inTransaction).toBe(false);
    await send("owner@example.invalid", "billing", {
      kind: "trial_ending_3d",
      href: "/app/billing",
    });
    return 1;
  });
  startAuthCleanup();
  await vi.advanceTimersByTimeAsync(0);
  expect(deliverNotifications).toHaveBeenCalledTimes(1);
  expect(vi.mocked(generateNotifications).mock.calls[0]).toHaveLength(2);
  expect(sendMail).toHaveBeenCalledWith({
    from: "fixture@example.invalid",
    to: "owner@example.invalid",
    subject: "Your BookHost workspace: billing notice",
    text: "billing\n\nManage billing: https://bookhost.example/app/billing",
  });
});
