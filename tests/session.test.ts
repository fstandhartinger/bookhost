import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ version: 1 }));
vi.mock("@/lib/db", () => ({
  db: {
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith("UPDATE")) state.version++;
      return { rows: [{ session_version: state.version }] };
    }),
  },
}));
import { sessionToken } from "../lib/session";
beforeEach(() => {
  state.version = 1;
});
it("revokes the checkout browser when the mailbox owner signs in", async () => {
  const checkout = { sub: "owner", session_version: 1 };
  expect(await sessionToken(checkout)).toEqual(checkout);
  const verified = await sessionToken({}, "owner");
  expect(verified?.session_version).toBe(2);
  expect(await sessionToken(checkout)).toBeNull();
  expect(await sessionToken(verified!)).toEqual(verified);
  await sessionToken({}, "owner");
  expect(await sessionToken(verified!)).toBeNull();
});
it("rejects legacy tokens without a version", async () => {
  expect(await sessionToken({ sub: "owner" })).toBeNull();
  expect(await sessionToken({})).toBeNull();
});
it("password login neither verifies email nor revokes existing sessions", async () => {
  const existing = { sub: "owner", session_version: 1 };
  expect(await sessionToken({ sub: "owner", session_version: 1 })).toEqual(
    existing,
  );
  expect(state.version).toBe(1);
  expect(await sessionToken(existing)).toEqual(existing);
});
