import { readFileSync, readdirSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import * as notices from "../lib/notifications";
import type { Queryable } from "../lib/billing";

afterEach(() => vi.useRealTimers());
it("explicitly classifies every persisted notice kind; unknown and activation kinds never mail", () => {
  const kinds = new Set<string>();
  for (const file of readdirSync("db/migrations")) {
    const sql = readFileSync(`db/migrations/${file}`, "utf8");
    for (const match of sql.matchAll(/CHECK\s*\(\s*kind IN\s*\(([^)]+)\)/gi))
      for (const kind of match[1].matchAll(/'([^']+)'/g)) kinds.add(kind[1]);
  }
  expect(Object.keys(notices.noticeDelivery).sort()).toEqual([...kinds].sort());
  for (const kind of kinds)
    expect(notices.noticeDelivery[kind as keyof typeof notices.noticeDelivery]).toBe(
      kind.startsWith("activation_") ? "in_app" : "in_app_and_email",
    );
  expect(notices.canEmailNotice("future_notice")).toBe(false);
  expect(notices.canEmailNotice("toString")).toBe(false);
});

it("commits a claim before SMTP and never resends after a lost status update", async () => {
  let claimed = false;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("RETURNING")) {
      if (claimed) return { rows: [] };
      claimed = true;
      return { rows: [{ id: "one", kind: "payment_failed", email: "test@example.invalid", payload: { text: "billing", href: "/app/billing" } }] };
    }
    throw new Error("status update connection lost");
  });
  const send = vi.fn(async () => { expect(claimed).toBe(true); });
  await expect(notices.deliverNotifications({ query } as unknown as Queryable, send)).rejects.toThrow("connection lost");
  await notices.deliverNotifications({ query } as unknown as Queryable, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("FOR UPDATE SKIP LOCKED");
  expect(query.mock.calls[0][0]).toContain("mail_claimed_at IS NULL");
});

it("bounds stalled messages and ignores in-app rows without status updates", async () => {
  vi.useFakeTimers();
  const query = vi.fn().mockResolvedValueOnce({ rows: [
    { id: "activation", kind: "activation_workspace", payload: {} },
    { id: "bill", kind: "payment_failed", email: "test@example.invalid", payload: { text: "billing", href: "/app/billing" } },
  ] }).mockResolvedValue({ rows: [] });
  const send = vi.fn(() => new Promise(() => {}));
  const delivery = notices.deliverNotifications({ query } as unknown as Queryable, send);
  await vi.advanceTimersByTimeAsync(30_001);
  await delivery;
  expect(send).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("LIMIT 300");
  expect(query.mock.calls.slice(1)).toEqual([[expect.any(String), ["bill", "mail_failed"]]]);
});
