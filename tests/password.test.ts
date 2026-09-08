import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  signedIn: true,
  password: "fixture-password",
}));
vi.mock("@/auth", () => ({
  auth: async () => (state.signedIn ? { user: { id: "owner-fixture" } } : null),
}));
vi.mock("@/lib/security", () => ({
  sameOrigin: (r: Request) =>
    r.headers.get("origin") !== "https://foreign.invalid",
}));
vi.mock("@/lib/db", () => ({
  transaction: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: unknown[]) => {
        if (sql.startsWith("SELECT")) {
          expect(sql).toContain("tm.owner_user_id=$1");
          expect(params).toEqual(["owner-fixture"]);
          return {
            rows: [{ id: "tenant-fixture", initial_password: state.password }],
          };
        }
        state.password = "";
        return { rowCount: 1 };
      },
    }),
}));
import { POST } from "@/app/api/tenants/password/route";
beforeEach(() => {
  state.signedIn = true;
  state.password = "fixture-password";
});
it("reveals and deletes a password once, without caching", async () => {
  const response = await POST(
    new Request("http://localhost/api/tenants/password", { method: "POST" }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ password: "fixture-password" });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(
    (
      await POST(
        new Request("http://localhost/api/tenants/password", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(410);
});
it("requires a signed-in owner", async () => {
  state.signedIn = false;
  expect(
    (
      await POST(
        new Request("http://localhost/api/tenants/password", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
});
it("rejects cross-origin requests", async () => {
  expect(
    (
      await POST(
        new Request("http://localhost/api/tenants/password", {
          method: "POST",
          headers: { origin: "https://foreign.invalid" },
        }),
      )
    ).status,
  ).toBe(403);
  expect(state.password).toBe("fixture-password");
});
