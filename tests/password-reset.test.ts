import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ exists: true, usable: true, mail: vi.fn() }));
vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: state.mail }),
}));
vi.mock("@/lib/password", () => ({ hashPassword: async () => "argon-hash" }));
vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT"))
      return { rows: state.exists ? [{ id: "user", user_id: "user" }] : [] };
    if (sql.includes("RETURNING user_id")) {
      const ok = state.usable;
      state.usable = false;
      return { rows: [], rowCount: ok ? 1 : 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  return {
    db: { query },
    transaction: async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
  };
});
import { sendPasswordReset, resetPassword } from "../lib/password-reset";
import { db } from "../lib/db";
beforeEach(() => {
  state.exists = true;
  state.usable = true;
  vi.clearAllMocks();
});
it("sends a 30 minute token and stores only its SHA256 hash", async () => {
  await sendPasswordReset("user@example.com");
  expect(state.mail).toHaveBeenCalledOnce();
  const text = state.mail.mock.calls[0][0].text;
  const token = text.match(/token=([a-f0-9]{64})/)[1];
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("interval '30 minutes'"),
    [expect.stringMatching(/^[a-f0-9]{64}$/), "user"],
  );
  expect(JSON.stringify(vi.mocked(db.query).mock.calls)).not.toContain(token);
});
it("does not send email for an unknown account", async () => {
  state.exists = false;
  await sendPasswordReset("missing@example.com");
  expect(state.mail).not.toHaveBeenCalled();
});
it("consumes once, bumps session version, and invalidates outstanding tokens", async () => {
  expect(await resetPassword("a".repeat(64), "new-password")).toBe(true);
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("session_version=session_version+1"),
    ["user", "argon-hash"],
  );
  expect(await resetPassword("a".repeat(64), "new-password")).toBe(false);
});
it("rejects expired and malformed tokens without changing the password", async () => {
  state.usable = false;
  expect(await resetPassword("a".repeat(64), "new-password")).toBe(false);
  expect(await resetPassword("bad", "new-password")).toBe(false);
  expect(
    vi
      .mocked(db.query)
      .mock.calls.some(([sql]) => String(sql).startsWith("UPDATE users")),
  ).toBe(false);
});
