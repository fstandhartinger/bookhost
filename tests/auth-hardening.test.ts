import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  after: [] as (() => Promise<void>)[],
  exists: true,
  mail: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 150));
  }),
  hash: vi.fn(async () => "hash"),
}));
vi.mock("next-auth", async () => ({
  CredentialsSignin: (await import("@auth/core/errors")).CredentialsSignin,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: (fn: () => Promise<void>) => state.after.push(fn),
}));
vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: state.mail }),
}));
vi.mock("argon2", () => ({
  default: { argon2id: 2, hash: state.hash, verify: async () => false },
}));
vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.startsWith("INSERT INTO rate_limits")) {
      const key = String(args[0]);
      const hits = (state.counts.get(key) || 0) + 1;
      state.counts.set(key, hits);
      return { rows: [{ hits }] };
    }
    if (sql.startsWith("SELECT"))
      return {
        rows: state.exists
          ? [
              {
                id: "user",
                password_hash: null,
                email_verified_at: null,
                session_version: 1,
              },
            ]
          : [],
      };
    if (sql.startsWith("UPDATE users"))
      return {
        rows: [{ id: "user", email: "user@example.com", session_version: 2 }],
      };
    return { rows: [] };
  });
  return {
    db: { query },
    transaction: async (fn: (c: { query: typeof query }) => unknown) =>
      fn({ query }),
  };
});
import { clientIp, digest, freshAuthentication } from "../lib/security";
import { authorizePassword, changePassword } from "../lib/password";
import { resetPassword } from "../lib/password-reset";
import { POST } from "../app/api/account/reset/route";
import { sessionToken } from "../lib/session";
const req = (body: unknown, ip = "192.0.2.1") =>
  new Request("https://wissen.app.mintapis.com/api/account/reset", {
    method: "POST",
    headers: {
      origin: "https://wissen.app.mintapis.com",
      "x-forwarded-for": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  state.counts.clear();
  state.after = [];
  state.exists = true;
  vi.clearAllMocks();
  vi.stubEnv("TRUST_PROXY", "true");
  vi.stubEnv("SMTP_HOST", "fixture");
  vi.stubEnv("SMTP_FROM", "test@example.com");
});
it("empty emails do not consume reset limits; redemption is keyed by token hash and IP", async () => {
  for (let i = 0; i < 5; i++) expect((await POST(req({}))).status).toBe(400);
  expect(state.counts.size).toBe(0);
  expect((await POST(req({ email: " User@Example.com " }))).status).toBe(200);
  await POST(req({ token: "a", password: "short" }));
  expect(
    state.counts.has(
      "password-reset-token:" + digest("a") + ":" + digest("192.0.2.1"),
    ),
  ).toBe(true);
  expect(state.counts.has("password-reset-email:" + digest(""))).toBe(false);
});
it("known and unknown reset responses differ by less than 50ms with slow mocked SMTP", async () => {
  const elapsed: number[] = [];
  for (const email of ["known@example.com", "missing@example.com"]) {
    const start = performance.now();
    expect((await POST(req({ email }))).status).toBe(200);
    elapsed.push(performance.now() - start);
  }
  expect(Math.abs(elapsed[0] - elapsed[1])).toBeLessThan(50);
  expect(state.mail).not.toHaveBeenCalled();
  await state.after[0]();
  state.exists = false;
  await state.after[1]();
  expect(state.mail).toHaveBeenCalledOnce();
});
it("requires fresh authentication or verified email for first password and preserves auth_time on refresh", async () => {
  const now = Math.floor(Date.now() / 1000);
  expect(
    await changePassword("user", "long-password", "", now - 900),
  ).toBeNull();
  expect(state.hash).not.toHaveBeenCalled();
  expect(
    await changePassword("user", "long-password", "", now - 899),
  ).toMatchObject({ id: "user" });
  expect(
    (
      await sessionToken({
        sub: "user",
        session_version: 1,
        auth_time: now - 901,
      })
    )?.auth_time,
  ).toBe(now - 901);
  expect(freshAuthentication(undefined)).toBe(false);
  expect(freshAuthentication(now + 10)).toBe(false);
});
it("limits one account across three IPs after 30 failures", async () => {
  for (let i = 0; i < 30; i++)
    expect(
      await authorizePassword(
        { email: "USER@example.com", password: "wrong" },
        req({}, `192.0.2.${1 + Math.floor(i / 10)}`),
      ),
    ).toBeNull();
  await expect(
    authorizePassword(
      { email: "user@example.com", password: "wrong" },
      req({}, "192.0.2.4"),
    ),
  ).rejects.toMatchObject({ code: "rate_limited" });
});
it("trusts the last forwarded IP only when enabled, otherwise socket/x-real-ip, and rejects missing IP", async () => {
  expect(clientIp(req({}, "198.51.100.1, 192.0.2.2"))).toBe("192.0.2.2");
  vi.stubEnv("TRUST_PROXY", "false");
  expect(clientIp(req({}))).toBeNull();
  const direct = new Request("http://localhost", {
    headers: {
      origin: "https://wissen.app.mintapis.com",
      "x-real-ip": "127.0.0.1",
      "x-forwarded-for": "198.51.100.1",
    },
  });
  expect(clientIp(direct)).toBe("127.0.0.1");
  Object.assign(direct, { socket: { remoteAddress: "::1" } });
  expect(clientIp(direct)).toBe("::1");
  expect((await POST(req({ email: "user@example.com" }))).status).toBe(400);
  expect(state.counts.size).toBe(0);
});
it("rejects nonexistent reset tokens and users without spending Argon2 work", async () => {
  state.exists = false;
  expect(await resetPassword("a".repeat(64), "long-password")).toBe(false);
  expect(await changePassword("missing", "long-password", "")).toBeNull();
  expect(state.hash).not.toHaveBeenCalled();
});
