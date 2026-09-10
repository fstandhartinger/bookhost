import { afterEach, expect, it, vi } from "vitest";
vi.mock("../lib/notifications", () => ({
  generateNotifications: vi.fn(async () => 0),
}));
vi.mock("@/lib/db", () => ({
  transaction: async (fn: (c: object) => Promise<unknown>) => fn({}),
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("../lib/password-mail", () => ({
  mailTransport: () => ({ sendMail }),
}));
vi.mock("../lib/config", () => ({ baseUrl: () => "https://bookhost.example" }));
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
import { generateNotifications } from "../lib/notifications";
import { startAuthCleanup } from "../lib/auth-cleanup";
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete (
    globalThis as typeof globalThis & { authCleanupTimer?: NodeJS.Timeout }
  ).authCleanupTimer;
});
it("routes activation subjects and links through the existing SMTP sender, preserving billing", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SMTP_HOST", "fixture.invalid");
  vi.stubEnv("SMTP_FROM", "fixture@example.invalid");
  startAuthCleanup();
  await vi.advanceTimersByTimeAsync(0);
  const send = vi.mocked(generateNotifications).mock.calls[0][2]!;
  // The third argument is the outbox metadata introduced by the activation change.
  const deliver = send as (
    email: string,
    text: string,
    meta: { kind: string; href: string },
  ) => Promise<unknown>;
  await deliver("owner@example.invalid", "workspace", {
    kind: "activation_workspace",
    href: "/app",
  });
  expect(sendMail).toHaveBeenLastCalledWith({
    from: "fixture@example.invalid",
    to: "owner@example.invalid",
    subject: "Your BookHost workspace: next step",
    text: "workspace\n\nNext step: https://bookhost.example/app",
  });
  await deliver("owner@example.invalid", "page", {
    kind: "activation_first_page",
    href: "/app/intake",
  });
  expect(sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      subject: "Your BookHost workspace: next step",
      text: "page\n\nNext step: https://bookhost.example/app/intake",
    }),
  );
  await deliver("owner@example.invalid", "billing", {
    kind: "trial_ending_3d",
    href: "/app/billing",
  });
  expect(sendMail).toHaveBeenLastCalledWith(
    expect.objectContaining({
      subject: "Your BookHost workspace: billing notice",
      text: "billing\n\nManage billing: https://bookhost.example/app/billing",
    }),
  );
});
