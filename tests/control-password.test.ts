import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next-auth", async () => ({
  CredentialsSignin: (await import("@auth/core/errors")).CredentialsSignin,
}));
const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  allowed: true,
  version: 1,
}));
vi.mock("@/lib/db", () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("UPDATE users"))
      return { rows: [{ id: "user", session_version: ++state.version }] };
    return { rows: state.user ? [state.user] : [] };
  });
  return {
    db: { query },
    transaction: async (fn: (client: { query: typeof query }) => unknown) =>
      fn({ query }),
  };
});
vi.mock("@/lib/security", () => ({
  digest: (s: string) => s,
  clientIp: () => "1.2.3.4",
  freshAuthentication: (t: number) =>
    typeof t === "number" && Date.now() / 1000 - t < 900,
  rateLimit: vi.fn(async () => state.allowed),
}));
import {
  authorizePassword,
  changePassword,
  hashPassword,
  verifyPassword,
  validNewPassword,
} from "../lib/password";
import { rateLimit } from "../lib/security";
import { db } from "../lib/db";
const request = new Request("http://localhost", {
  headers: { "x-forwarded-for": "1.2.3.4" },
});
beforeEach(() => {
  state.user = null;
  state.allowed = true;
  state.version = 1;
  vi.clearAllMocks();
});
it("uses Argon2id with random salts and verifies correct, wrong, and missing hashes", async () => {
  const hash = await hashPassword("long-password");
  expect(hash).toMatch(/^\$argon2id\$/);
  expect(await hashPassword("long-password")).not.toBe(hash);
  expect(await verifyPassword(hash, "long-password")).toBe(true);
  expect(await verifyPassword(hash, "wrong")).toBe(false);
  expect(await verifyPassword(null, "long-password")).toBe(false);
});
it("authorizes the correct credentials without returning the hash", async () => {
  state.user = {
    id: "user",
    email: "user@example.com",
    name: "User",
    session_version: 1,
    password_hash: await hashPassword("long-password"),
  };
  expect(
    await authorizePassword(
      { email: " User@Example.com ", password: "long-password" },
      request,
    ),
  ).toEqual({
    id: "user",
    email: "user@example.com",
    name: "User",
    session_version: 1,
  });
  expect(rateLimit).toHaveBeenCalledWith(
    "password:user@example.com:1.2.3.4",
    10,
    900,
  );
  expect(
    await authorizePassword(
      { email: "user@example.com", password: "wrong" },
      request,
    ),
  ).toBeNull();
  state.user = null;
  expect(
    await authorizePassword(
      { email: "missing@example.com", password: "wrong" },
      request,
    ),
  ).toBeNull();
});
it("rejects a throttled attempt before hashing or querying users", async () => {
  state.allowed = false;
  await expect(
    authorizePassword(
      { email: "user@example.com", password: "wrong" },
      request,
    ),
  ).rejects.toMatchObject({ code: "rate_limited" });
  expect(db.query).not.toHaveBeenCalled();
});
it("requires the old password and bumps the version only on a successful change", async () => {
  state.user = { password_hash: await hashPassword("old-password") };
  expect(await changePassword("user", "new-password", "wrong")).toBeNull();
  expect(state.version).toBe(1);
  expect(
    await changePassword("user", "new-password", "old-password"),
  ).toMatchObject({ session_version: 2 });
  expect(db.query).toHaveBeenCalledWith(
    expect.stringContaining("UPDATE password_reset_tokens"),
    ["user"],
  );
});
it("sets the first password and validates length and confirmation", async () => {
  state.user = { password_hash: null, email_verified_at: new Date() };
  expect(await changePassword("user", "new-password", "")).toMatchObject({
    session_version: 2,
  });
  expect(validNewPassword("123456789", "123456789")).toBe(false);
  expect(validNewPassword("1234567890", "different")).toBe(false);
  expect(validNewPassword("1234567890", "1234567890")).toBe(true);
});
