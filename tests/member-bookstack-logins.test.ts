import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  auth: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: { query: mocks.query },
  transaction: (fn: (c: unknown) => unknown) => fn({ query: mocks.query }),
}));
vi.mock("next-auth", () => ({ CredentialsSignin: class extends Error {} }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/intake/crypto", () => ({ decrypt: () => "test-token-secret" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { ensureBookStackLogin } from "@/lib/bookstack-members";
import { joinTeam } from "@/lib/team";
import { POST as create } from "@/app/api/bookstack/login/route";
import { POST as reveal } from "@/app/api/bookstack/password/route";
import { MemberBookStackLogin } from "@/components/member-bookstack-login";
const team = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
let membership: Record<string, unknown> | null;
let login: Record<string, unknown> | undefined;
let existing: boolean;
const req = (body: unknown = { teamId: team }) =>
  new Request("https://bookhost.co/api/bookstack/login", {
    method: "POST",
    headers: {
      origin: "https://bookhost.co",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset();
  mocks.query.mockReset();
  mocks.auth.mockResolvedValue({ user: { id: user } });
  membership = {
    role: "member",
    email: "teammate@example.com",
    name: null,
    id: team,
    slug: "test-team",
    host: "test-team.wissen.app.mintapis.com",
    status: "running",
    desired_state: "running",
  };
  login = undefined;
  existing = false;
  mocks.query.mockImplementation(
    async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM team_invites"))
        return {
          rows: [
            {
              id: team,
              team_id: team,
              role: "member",
              uses: 0,
              max_uses: 10,
              expires_at: new Date(Date.now() + 86400000),
            },
          ],
        };
      if (sql.includes("FROM teams WHERE")) return { rows: [{ id: team }] };
      if (sql.includes("FROM users WHERE id="))
        return {
          rows: [
            { id: user, email: "teammate@example.com", session_version: 1 },
          ],
        };
      if (sql.startsWith("SELECT 1 FROM memberships"))
        return { rows: [], rowCount: 0 };
      if (sql.includes("count(*) FROM memberships"))
        return { rows: [{ count: 1 }] };
      if (sql.includes("JOIN users") && sql.includes("memberships"))
        return { rows: membership ? [membership] : [] };
      if (sql.includes("FROM tenant_secrets"))
        return { rows: [{ api_id: "test-id", api_secret_enc: "encrypted" }] };
      if (sql.startsWith("SELECT") && sql.includes("member_bookstack_logins"))
        return { rows: membership && login ? [login] : [] };
      if (sql.startsWith("INSERT INTO member_bookstack_logins")) {
        login ||= {
          bookstack_user_id: null,
          initial_password: null,
          last_error: null,
        };
      }
      if (
        sql.startsWith("UPDATE member_bookstack_logins SET bookstack_user_id")
      )
        login = {
          bookstack_user_id: values[2],
          bookstack_role: values[3],
          initial_password: values[4],
          last_error: null,
        };
      if (sql.startsWith("UPDATE member_bookstack_logins SET last_error"))
        login = { ...login, last_error: values[2] };
      if (
        sql.startsWith(
          "UPDATE member_bookstack_logins SET initial_password=NULL",
        ) &&
        login
      )
        login.initial_password = null;
      return { rows: [] };
    },
  );
  mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.includes("/users?"))
      return Response.json({
        data: existing ? [{ id: 42, email: "teammate@example.com" }] : [],
        total: existing ? 1 : 0,
      });
    if (url.includes("/roles"))
      return Response.json({
        data: [{ id: 9, display_name: "Editor" }],
        total: 1,
      });
    if (init.method === "POST") return Response.json({ id: 43 });
    return Response.json({
      id: 42,
      roles: [{ id: 9, display_name: "Editor" }],
    });
  });
});
it("join creates an Editor account with a random password and no invite email", async () => {
  const result = await joinTeam("a".repeat(64), user, {}, 1);
  expect(result.id).toBe(user);
  const call = mocks.fetch.mock.calls.find(
    ([, init]) => init.method === "POST",
  );
  expect(call).toBeDefined();
  const body = JSON.parse(call![1].body);
  expect(body).toMatchObject({
    name: "teammate",
    email: "teammate@example.com",
    send_invite: false,
    roles: [9],
  });
  expect(body.password.length).toBeGreaterThanOrEqual(16);
  expect(login?.initial_password).toBe(body.password);
  expect(mocks.fetch.mock.calls[0][0]).toContain(
    "users?filter[email]=teammate%40example.com",
  );
});
it("links an existing email without creating or resetting the account", async () => {
  existing = true;
  await ensureBookStackLogin(team, user);
  expect(login).toMatchObject({
    bookstack_user_id: 42,
    initial_password: null,
  });
  expect(
    mocks.fetch.mock.calls.every(([, init]) => init.method === "GET"),
  ).toBe(true);
});
it("is idempotent and preserves a password already waiting for reveal", async () => {
  await ensureBookStackLogin(team, user);
  const saved = login?.initial_password;
  mocks.fetch.mockClear();
  await ensureBookStackLogin(team, user);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(login?.initial_password).toBe(saved);
});
it("API failure does not undo joining, stores a safe error, and shows retry", async () => {
  mocks.fetch.mockResolvedValue(
    new Response("secret echoed by upstream", { status: 403 }),
  );
  expect((await joinTeam("a".repeat(64), user, {}, 1)).id).toBe(user);
  expect(login?.last_error).toEqual(expect.any(String));
  expect(login?.last_error).not.toContain("secret");
  const html = renderToStaticMarkup(
    React.createElement(MemberBookStackLogin, {
      teamId: team,
      email: "teammate@example.com",
      host: "test-team.wissen.app.mintapis.com",
      login: {
        bookstack_user_id: null,
        bookstack_role: "Editor",
        has_password: false,
        last_error: String(login?.last_error),
      },
    }),
  );
  expect(html).toContain("Create my BookStack login");
});
it("reveals the password once and clears it with a private response", async () => {
  await ensureBookStackLogin(team, user);
  const password = login?.initial_password;
  const response = await reveal(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ password });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(login?.initial_password).toBeNull();
  expect((await reveal(req())).status).toBe(410);
});
it.each([create, reveal])(
  "rejects foreign user selectors and missing membership",
  async (handler) => {
    expect((await handler(req({ teamId: team, user_id: team }))).status).toBe(
      403,
    );
    expect((await handler(req({ teamId: team, userId: team }))).status).toBe(
      403,
    );
    membership = null;
    expect([403, 404]).toContain((await handler(req())).status);
  },
);
it("does not create a second account for the owner", async () => {
  membership!.role = "owner";
  await ensureBookStackLogin(team, user);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(login).toBeUndefined();
});
it("requires a running tenant and allows retry after recovery", async () => {
  membership!.status = "pending";
  await expect(ensureBookStackLogin(team, user)).rejects.toThrow("not running");
  expect(mocks.fetch).not.toHaveBeenCalled();
  membership!.status = "running";
  await ensureBookStackLogin(team, user);
  expect(login?.bookstack_user_id).toBe(43);
  expect(login?.last_error).toBeNull();
});
it("reports a missing Editor role without creating a user", async () => {
  mocks.fetch.mockImplementation(async () =>
    Response.json({ data: [], total: 0 }),
  );
  await expect(ensureBookStackLogin(team, user)).rejects.toThrow("Editor");
  expect(login?.last_error).toContain("Editor");
  expect(
    mocks.fetch.mock.calls.every(([, init]) => init.method === "GET"),
  ).toBe(true);
});
it.each([create, reveal])("requires auth and same origin", async (handler) => {
  mocks.auth.mockResolvedValue(null);
  expect((await handler(req())).status).toBe(401);
  expect(
    (
      await handler(
        new Request("https://bookhost.co/api/bookstack/login", {
          method: "POST",
          headers: { origin: "https://evil.invalid" },
        }),
      )
    ).status,
  ).toBe(403);
});

it("creates only the authenticated user's login and returns no credentials", async () => {
  membership!.role = "admin";
  const response = await create(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  const creation = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT INTO member_bookstack_logins"),
  );
  expect(creation?.[1]).toEqual([team, user]);
  expect(login?.bookstack_role).toBe("Editor");
});
it("renders creation for a missing login and reveal only while a password is stored", () => {
  const props = {
    teamId: team,
    email: "teammate@example.com",
    slug: "test-team",
    host: "test-team.wissen.app.mintapis.com",
  };
  expect(
    renderToStaticMarkup(React.createElement(MemberBookStackLogin, props)),
  ).toContain("Create my BookStack login");
  const ready = {
    bookstack_user_id: 43,
    bookstack_role: "Editor",
    has_password: true,
    last_error: null,
  };
  const html = renderToStaticMarkup(
    React.createElement(MemberBookStackLogin, { ...props, login: ready }),
  );
  expect(html).toContain("Reveal password once");
  expect(html).not.toContain("Create my BookStack login");
  expect(html).toContain("Change the password after your first sign-in");
  expect(
    renderToStaticMarkup(
      React.createElement(MemberBookStackLogin, {
        ...props,
        login: { ...ready, has_password: false },
      }),
    ),
  ).not.toContain("Reveal password once");
});
it("respects upstream rate limits without immediately retrying", async () => {
  mocks.fetch.mockImplementation(
    async () => new Response("rate limited", { status: 429 }),
  );
  await expect(ensureBookStackLogin(team, user)).rejects.toMatchObject({
    status: 429,
  });
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(login?.last_error).toContain("rate limit");
});

it("preserves an unrevealed password when retry relinks the same account after an error", async () => {
  existing = true;
  login = {
    bookstack_user_id: 42,
    initial_password: "fixture-unrevealed",
    last_error: "temporary error",
  };
  await ensureBookStackLogin(team, user);
  expect(login?.initial_password).toBe("fixture-unrevealed");
  expect(login?.last_error).toBeNull();
});

it.each([
  [42, null, null],
  [99, "old-account-password", null],
])(
  "never restores revealed or different-account credentials (saved account %s)",
  async (accountId, stored, expected) => {
    existing = true;
    login = {
      bookstack_user_id: accountId,
      initial_password: stored,
      last_error: "temporary error",
    };
    await ensureBookStackLogin(team, user);
    expect(login?.initial_password).toBe(expected);
    expect(login?.last_error).toBeNull();
  },
);
