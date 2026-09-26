import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "@/lib/db";
import { handleMcp, LIMITS } from "@/lib/agents/mcp";
import { workspaceLlmsTxt } from "@/lib/agents/public-llms";
import { publishAgentProposal } from "@/lib/agents/review";
import { decrypt, encrypt } from "@/lib/intake/crypto";
import { createAgent, revokeAgent, setAccess } from "@/lib/agents/manage";
import { itemForUser } from "@/lib/intake/access";

// End-to-end through the real MCP handler and a disposable Postgres (see
// ops/testdb.sh). BookStack is replaced by an in-memory fake with one token
// table per workspace, like real BookStack instances.
const RUN = process.env.INTAKE_DB_TEST === "1";
const SECRET_WORDS = "CONFIDENTIAL-SALARY-TABLE";

type Page = {
  id: number;
  name: string;
  book_id: number;
  chapter_id: number;
  markdown: string;
  revision_count: number;
  onlyFor?: string[];
};
type Instance = {
  tokens: Record<string, string>;
  pages: Page[];
  requests: { method: string; path: string; user: string }[];
  guest: boolean;
};
const instances: Record<string, Instance> = {};

function fakeBookStack(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(String(input));
  const inst = instances[url.hostname];
  if (!inst) return Promise.reject(new Error("unknown host"));
  const auth = new Headers(init?.headers).get("authorization") || "";
  const method = init?.method || "GET";
  const path = url.pathname + url.search;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  if (!url.pathname.startsWith("/api/")) {
    // Anonymous web requests (llms.txt): only a guest-enabled instance lists content.
    if (!inst.guest)
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: `https://${url.hostname}/login` },
        }),
      );
    if (url.pathname === "/books" && !url.search)
      return Promise.resolve(
        new Response(
          `<a href="https://${url.hostname}/books/public-book" class="book entity-list-item" data-entity-type="book" data-entity-id="1"><h4 class="entity-list-item-name break-text">Public book</h4></a>`,
          { status: 200 },
        ),
      );
    if (url.pathname === "/books/public-book")
      return Promise.resolve(
        new Response(
          `<a href="https://${url.hostname}/books/public-book/page/welcome" class="page entity-list-item" data-entity-type="page" data-entity-id="1"><h4 class="entity-list-item-name break-text">Welcome</h4></a>`,
          { status: 200 },
        ),
      );
    if (url.pathname.endsWith("/export/markdown"))
      return Promise.resolve(new Response("# Welcome", { status: 200 }));
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  const user = inst.tokens[auth.replace(/^Token /, "")];
  if (!user)
    return json({ error: { message: "The provided token is invalid" } }, 401);
  inst.requests.push({ method, path, user });
  const visible = inst.pages.filter(
    (p) => !p.onlyFor || p.onlyFor.includes(user),
  );
  const api = url.pathname.slice(5);
  let m: RegExpExecArray | null;
  if (api.startsWith("roles"))
    return json({
      data: [
        { id: 1, display_name: "Admin", system_name: "admin" },
        { id: 2, display_name: "Editor", system_name: "" },
        { id: 3, display_name: "Viewer", system_name: "" },
      ],
      total: 3,
    });
  if (api === "books" && method === "GET")
    return json({
      data: [{ id: 1, name: "Handbook", slug: "handbook" }],
      total: 1,
    });
  if ((m = /^books\/(\d+)$/.exec(api)))
    return json({
      id: Number(m[1]),
      name: "Handbook",
      slug: "handbook",
      contents: visible.map((p) => ({
        id: p.id,
        name: p.name,
        slug: `p${p.id}`,
        type: "page",
      })),
    });
  if ((m = /^pages\/(\d+)\/export\/(markdown|plaintext)$/.exec(api))) {
    const page = visible.find((p) => p.id === Number(m![1]));
    return page
      ? Promise.resolve(new Response(page.markdown, { status: 200 }))
      : json({ error: { message: "Not found" } }, 404);
  }
  if ((m = /^pages\/(\d+)$/.exec(api))) {
    const page = visible.find((p) => p.id === Number(m![1]));
    if (!page) return json({ error: { message: "Not found" } }, 404);
    if (method === "PUT") {
      const body = JSON.parse(String(init?.body));
      if (body.markdown !== undefined) page.markdown = body.markdown;
      if (body.name) page.name = body.name;
      page.revision_count += 1;
    }
    return json({
      ...page,
      slug: `p${page.id}`,
      book_slug: "handbook",
      editor: "markdown",
      html: `<p>${page.markdown}</p>`,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      created_by: { name: "Ada" },
      updated_by: { name: "Ada" },
    });
  }
  if (api === "pages" && method === "POST") {
    const body = JSON.parse(String(init?.body));
    const page = {
      id: 100 + inst.pages.length,
      name: body.name,
      book_id: body.book_id || 1,
      chapter_id: 0,
      markdown: body.markdown,
      revision_count: 1,
    };
    inst.pages.push(page);
    return json(page);
  }
  if (api === "search")
    return json({
      data: visible.map((p) => ({
        type: "page",
        id: p.id,
        name: p.name,
        url: `https://${url.hostname}/link/${p.id}`,
        preview_html: { content: p.markdown.slice(0, 50) },
      })),
      total: visible.length,
    });
  if (api === "comments" && method === "POST") return json({ id: 7 });
  return json({ error: { message: "Not found" } }, 404);
}

const ids: { users: string[]; teams: string[]; tenants: string[] } = {
  users: [],
  teams: [],
  tenants: [],
};
let hostA = "";
let hostB = "";
let tenantA = "";
const TOKEN_A = "A".repeat(32) + ":" + "a".repeat(32);
const TOKEN_A_RESTRICTED = "R".repeat(32) + ":" + "r".repeat(32);
const TOKEN_B = "B".repeat(32) + ":" + "b".repeat(32);
const SERVICE_A = "S".repeat(32) + ":" + "s".repeat(32);
let ipCounter = 0;

async function call(
  host: string,
  token: string | null,
  body: unknown,
  ip?: string,
) {
  const response = await handleMcp(
    new Request(`https://${host}/mcp`, {
      method: "POST",
      headers: {
        host,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-real-ip": ip || `198.51.100.${(ipCounter++ % 200) + 1}`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { fetcher: fakeBookStack as typeof fetch },
  );
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
const tool = (
  host: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) =>
  call(host, token, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
const text = (r: Awaited<ReturnType<typeof call>>) =>
  r.body.result.content[0].text as string;

async function makeTenant(label: string) {
  const user = (
    await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
      `agent-${label}-${crypto.randomUUID()}@example.invalid`,
    ])
  ).rows[0].id;
  ids.users.push(user);
  const team = (
    await db.query(
      "INSERT INTO teams(name,owner_user_id) VALUES($1,$2) RETURNING id",
      [`Agent ${label}`, user],
    )
  ).rows[0].id;
  ids.teams.push(team);
  await db.query(
    "INSERT INTO memberships(user_id,team_id,role) VALUES($1,$2,'owner')",
    [user, team],
  );
  await db.query(
    "INSERT INTO subscriptions(team_id,stripe_subscription_id,status,trial_end) VALUES($1,$2,'trialing',now()+interval '7 days')",
    [team, `sub_agent_${crypto.randomUUID()}`],
  );
  const slug = `agent${label}${crypto.randomUUID().slice(0, 8)}`;
  const host = `${slug}.bookhost.co`;
  const tenant = (
    await db.query(
      "INSERT INTO tenants(team_id,slug,host,status,desired_state) VALUES($1,$2,$3,'running','running') RETURNING id",
      [team, slug, host],
    )
  ).rows[0].id;
  ids.tenants.push(tenant);
  return { user, team, tenant, host, slug };
}

describe.skipIf(!RUN)("agent access (MCP) against Postgres", () => {
  let ownerA = "";
  beforeAll(async () => {
    vi.stubEnv("INTAKE_KMS_KEY", "ab".repeat(32));
    // The approval path uses the intake service client, which calls global fetch.
    vi.stubGlobal("fetch", fakeBookStack);
    const a = await makeTenant("a");
    const b = await makeTenant("b");
    hostA = a.host;
    hostB = b.host;
    tenantA = a.tenant;
    ownerA = a.user;
    await db.query(
      "INSERT INTO tenant_secrets(tenant_id,api_id,api_secret_enc) VALUES($1,$2,$3)",
      [
        a.tenant,
        SERVICE_A.split(":")[0],
        encrypt(SERVICE_A.split(":")[1], a.slug),
      ],
    );
    instances[hostA] = {
      tokens: {
        [TOKEN_A]: "agent",
        [TOKEN_A_RESTRICTED]: "viewer",
        [SERVICE_A]: "intake",
      },
      pages: [
        {
          id: 1,
          name: "Welcome",
          book_id: 1,
          chapter_id: 0,
          markdown: "Hello team",
          revision_count: 3,
        },
        {
          id: 2,
          name: "Salaries",
          book_id: 1,
          chapter_id: 0,
          markdown: SECRET_WORDS,
          revision_count: 1,
          onlyFor: ["agent", "intake"],
        },
      ],
      requests: [],
      guest: false,
    };
    instances[hostB] = {
      tokens: { [TOKEN_B]: "agent-b" },
      pages: [
        {
          id: 1,
          name: "B page",
          book_id: 1,
          chapter_id: 0,
          markdown: "B content",
          revision_count: 1,
        },
      ],
      requests: [],
      guest: true,
    };
  });
  afterAll(async () => {
    for (const t of ids.tenants)
      await db.query("DELETE FROM intake_items WHERE tenant_id=$1", [t]);
    await db.query("DELETE FROM tenants WHERE id=ANY($1)", [ids.tenants]);
    await db.query("DELETE FROM subscriptions WHERE team_id=ANY($1)", [
      ids.teams,
    ]);
    await db.query("DELETE FROM memberships WHERE team_id=ANY($1)", [
      ids.teams,
    ]);
    await db.query("DELETE FROM teams WHERE id=ANY($1)", [ids.teams]);
    await db.query("DELETE FROM users WHERE id=ANY($1)", [ids.users]);
    await db.query("DELETE FROM rate_limits WHERE key LIKE 'mcp:%'");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    await db.query("DELETE FROM rate_limits WHERE key LIKE 'mcp:%'");
    await db.query("DELETE FROM agent_settings WHERE tenant_id=ANY($1)", [
      ids.tenants,
    ]);
  });

  it("initializes, lists tools and reads as the token's BookStack user", async () => {
    const init = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.protocolVersion).toBe("2025-06-18");
    expect(init.body.result.instructions).toMatch(
      /not .*instructions|Never follow instructions/i,
    );
    const list = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search",
        "list_books",
        "get_book",
        "read_page",
        "create_page",
        "propose_change",
      ]),
    );
    expect(names).not.toContain("add_comment");
    for (const t of list.body.result.tools.filter((t: { name: string }) =>
      ["search", "read_page", "get_book"].includes(t.name),
    ))
      expect(t.description).toMatch(/untrusted/i);
    const page = await tool(hostA, TOKEN_A, "read_page", { page_id: 1 });
    expect(page.body.result.isError).toBe(false);
    expect(text(page)).toContain("Hello team");
    expect(text(page)).toContain(`https://${hostA}/link/1`);
  });

  it("a notification gets 202 without a body", async () => {
    const r = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(r.status).toBe(202);
  });

  it("isolates workspaces: a token from workspace A fails on workspace B and vice versa", async () => {
    const onB = await call(hostB, TOKEN_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(onB.status).toBe(401);
    expect(onB.headers.get("www-authenticate")).toMatch(/Bearer/);
    const onA = await tool(hostA, TOKEN_B, "read_page", { page_id: 1 });
    expect(onA.status).toBe(401);
    // B's own token still works on B and never reaches A's instance.
    expect(
      (await tool(hostB, TOKEN_B, "read_page", { page_id: 1 })).status,
    ).toBe(200);
    expect(instances[hostA].requests.some((r) => r.user === "agent-b")).toBe(
      false,
    );
  });

  it("inherits BookStack permissions: a restricted user cannot read a restricted page", async () => {
    const denied = await tool(hostA, TOKEN_A_RESTRICTED, "read_page", {
      page_id: 2,
    });
    expect(denied.body.result.isError).toBe(true);
    expect(text(denied)).not.toContain(SECRET_WORDS);
    const search = await tool(hostA, TOKEN_A_RESTRICTED, "search", {
      query: "salary",
    });
    expect(text(search)).not.toContain("Salaries");
    const allowed = await tool(hostA, TOKEN_A, "read_page", { page_id: 2 });
    expect(text(allowed)).toContain(SECRET_WORDS);
  });

  it("rejects missing, malformed and internal service tokens", async () => {
    expect(
      (await call(hostA, null, { jsonrpc: "2.0", id: 1, method: "tools/list" }))
        .status,
    ).toBe(401);
    expect(
      (
        await call(hostA, "not-a-token", {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        })
      ).status,
    ).toBe(401);
    const service = await call(hostA, SERVICE_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(service.status).toBe(403);
    expect(
      await call("unknown-workspace.bookhost.co", TOKEN_A, {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await call("bookhost.co", TOKEN_A, {
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      }),
    ).toMatchObject({ status: 404 });
  });

  it("enforces write mode: off hides writes, propose queues a review draft, direct writes as the user", async () => {
    await db.query(
      "INSERT INTO agent_settings(tenant_id,write_mode) VALUES($1,'off')",
      [tenantA],
    );
    const offList = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(
      offList.body.result.tools.map((t: { name: string }) => t.name),
    ).not.toContain("create_page");
    const offCall = await tool(hostA, TOKEN_A, "create_page", {
      book_id: 1,
      name: "X",
      markdown: "x",
    });
    expect(offCall.body.result.isError).toBe(true);
    expect(instances[hostA].requests.some((r) => r.method !== "GET")).toBe(
      false,
    );

    await db.query(
      "UPDATE agent_settings SET write_mode='propose' WHERE tenant_id=$1",
      [tenantA],
    );
    const before = instances[hostA].pages.length;
    const proposed = await tool(hostA, TOKEN_A, "update_page", {
      page_id: 1,
      markdown: "Hello team, updated by agent",
      expected_revision_count: 3,
      note: "typo fix",
    });
    expect(JSON.parse(text(proposed)).result).toBe("proposed");
    expect(instances[hostA].pages.length).toBe(before);
    expect(instances[hostA].pages[0].markdown).toBe("Hello team");
    expect(instances[hostA].requests.some((r) => r.method !== "GET")).toBe(
      false,
    );
    const item = (
      await db.query(
        "SELECT * FROM intake_items WHERE tenant_id=$1 AND source='agent' ORDER BY created_at DESC LIMIT 1",
        [tenantA],
      )
    ).rows[0];
    expect(item.status).toBe("draft");
    expect(item.source_metadata).toMatchObject({
      kind: "update",
      page_id: 1,
      base_revision_count: 3,
      note: "typo fix",
    });

    // Human approval applies it through the service user, with a revision check.
    const applied = await publishAgentProposal(
      {
        ...item,
        role: "owner",
        slug:
          item.slug ??
          (
            await db.query("SELECT slug,host FROM tenants WHERE id=$1", [
              tenantA,
            ])
          ).rows[0].slug,
        host: hostA,
      },
      ownerA,
    );
    expect(applied.url).toContain("/link/1");
    expect(instances[hostA].pages[0].markdown).toBe(
      "Hello team, updated by agent",
    );
    expect(instances[hostA].requests.at(-1)).toMatchObject({
      method: "PUT",
      user: "intake",
    });

    // A stale proposal is refused instead of overwriting the newer human edit.
    await tool(hostA, TOKEN_A, "update_page", {
      page_id: 1,
      markdown: "stale",
      note: "n",
    });
    const stale = (
      await db.query(
        "SELECT * FROM intake_items WHERE tenant_id=$1 AND source='agent' AND status='draft' ORDER BY created_at DESC LIMIT 1",
        [tenantA],
      )
    ).rows[0];
    instances[hostA].pages[0].revision_count += 1;
    await expect(
      publishAgentProposal(
        {
          ...stale,
          role: "owner",
          slug: (
            await db.query("SELECT slug FROM tenants WHERE id=$1", [tenantA])
          ).rows[0].slug,
          host: hostA,
        },
        ownerA,
      ),
    ).rejects.toThrow(/edited after the agent proposed/);
    expect(instances[hostA].pages[0].markdown).toBe(
      "Hello team, updated by agent",
    );

    await db.query(
      "UPDATE agent_settings SET write_mode='direct' WHERE tenant_id=$1",
      [tenantA],
    );
    const direct = await tool(hostA, TOKEN_A, "create_page", {
      book_id: 1,
      name: "Agent page",
      markdown: "Made by agent",
    });
    expect(JSON.parse(text(direct)).result).toBe("created");
    expect(instances[hostA].requests.at(-1)).toMatchObject({
      method: "POST",
      user: "agent",
    });
    const conflict = await tool(hostA, TOKEN_A, "update_page", {
      page_id: 1,
      markdown: "y",
      expected_revision_count: 1,
    });
    expect(text(conflict)).toMatch(/changed since you read it/);
    const list = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(
      list.body.result.tools.map((t: { name: string }) => t.name),
    ).toContain("add_comment");
  });

  it("dashboard agents: gateway token works only via MCP; revoke and kill switch apply at once", async () => {
    const created = await createAgent(ownerA, tenantA, {
      name: "Claude",
      role_id: 2,
    });
    const [tokenId, gatewaySecret] = created.token.split(":");
    const row = (
      await db.query("SELECT * FROM agents WHERE id=$1", [created.agent.id])
    ).rows[0];
    expect(row.gateway_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(gatewaySecret);
    // Pending: not usable yet.
    expect(
      (
        await call(hostA, created.token, {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
        })
      ).status,
    ).toBe(403);
    // What the host worker does: install the BookStack token, mark active.
    const slug = (
      await db.query("SELECT slug FROM tenants WHERE id=$1", [tenantA])
    ).rows[0].slug;
    const bookstackSecret = decrypt(row.bookstack_secret_enc, slug);
    expect(bookstackSecret).not.toBe(gatewaySecret);
    instances[hostA].tokens[`${tokenId}:${bookstackSecret}`] = "dash-agent";
    await db.query("UPDATE agents SET status='active' WHERE id=$1", [
      created.agent.id,
    ]);
    const read = await tool(hostA, created.token, "read_page", { page_id: 1 });
    expect(read.body.result.isError).toBe(false);
    expect(instances[hostA].requests.at(-1)).toMatchObject({
      user: "dash-agent",
    });
    // The agent's own credential is useless against BookStack's API directly.
    const direct = await fakeBookStack(`https://${hostA}/api/pages`, {
      method: "POST",
      headers: { Authorization: `Token ${created.token}` },
      body: "{}",
    });
    expect(direct.status).toBe(401);
    // A wrong gateway secret for a known token id is an auth failure.
    expect(
      (
        await call(hostA, `${tokenId}:${"x".repeat(32)}`, {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
        })
      ).status,
    ).toBe(403);
    // Revocation stops it immediately, before the worker deletes it in BookStack.
    await revokeAgent(ownerA, tenantA, created.agent.id);
    const revoked = await call(hostA, created.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.message).toMatch(/revoked/);
    expect(
      (
        await db.query("SELECT bookstack_secret_enc FROM agents WHERE id=$1", [
          created.agent.id,
        ])
      ).rows[0].bookstack_secret_enc,
    ).toBeNull();
    // Kill switch: every token is refused and dashboard agents are queued for revocation.
    const second = await createAgent(ownerA, tenantA, {
      name: "Cursor",
      role_id: 3,
    });
    await setAccess(ownerA, tenantA, false);
    expect(
      (await call(hostA, TOKEN_A, { jsonrpc: "2.0", id: 1, method: "ping" }))
        .status,
    ).toBe(403);
    expect(
      (
        await db.query("SELECT status FROM agents WHERE id=$1", [
          second.agent.id,
        ])
      ).rows[0].status,
    ).toBe("revoke_requested");
    await expect(
      createAgent(ownerA, tenantA, { name: "Late", role_id: 2 }),
    ).rejects.toThrow(/switched off/);
    await setAccess(ownerA, tenantA, true);
    await expect(
      createAgent(ownerA, tenantA, { name: "Admin agent", role_id: 1 }),
    ).rejects.toThrow(/cannot be given/);
    await db.query("DELETE FROM agents WHERE tenant_id=$1", [tenantA]);
  });

  it("members never see agent proposals; oversized, batched and version-mismatched requests are refused", async () => {
    const member = (
      await db.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        `agent-member-${crypto.randomUUID()}@example.invalid`,
      ])
    ).rows[0].id;
    ids.users.push(member);
    await db.query(
      "INSERT INTO memberships(user_id,team_id,role) VALUES($1,(SELECT team_id FROM tenants WHERE id=$2),'member')",
      [member, tenantA],
    );
    const item = (
      await db.query(
        "SELECT id FROM intake_items WHERE tenant_id=$1 AND source='agent' LIMIT 1",
        [tenantA],
      )
    ).rows[0];
    if (item) {
      await expect(itemForUser(member, item.id)).rejects.toThrow(/not found/i);
      await expect(itemForUser(ownerA, item.id)).resolves.toMatchObject({
        id: item.id,
      });
    }
    await db.query("DELETE FROM memberships WHERE user_id=$1", [member]);
    const big = await call(hostA, TOKEN_A, {
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: { pad: "x".repeat(600 * 1024) },
    });
    expect(big.status).toBe(413);
    const batch = await call(
      hostA,
      TOKEN_A,
      Array.from({ length: 6 }, (_, i) => ({
        jsonrpc: "2.0",
        id: i,
        method: "ping",
      })),
    );
    expect(batch.status).toBe(400);
    const small = await call(hostA, TOKEN_A, [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(small.body).toHaveLength(2);
    const versioned = await handleMcp(
      new Request(`https://${hostA}/mcp`, {
        method: "POST",
        headers: {
          host: hostA,
          "x-real-ip": "198.51.100.250",
          authorization: `Bearer ${TOKEN_A}`,
          "mcp-protocol-version": "1999-01-01",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      { fetcher: fakeBookStack as typeof fetch },
    );
    expect(versioned.status).toBe(400);
  });

  it("rate-limits per token", async () => {
    let last = 0;
    for (let i = 0; i <= LIMITS.perMinute; i++)
      last = (
        await call(hostA, TOKEN_A, { jsonrpc: "2.0", id: i, method: "ping" })
      ).status;
    expect(last).toBe(429);
    // Another token in the same workspace is unaffected.
    expect(
      (
        await call(hostA, TOKEN_A_RESTRICTED, {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
        })
      ).status,
    ).toBe(200);
  });

  it("blocks an address after repeated failed authentication", async () => {
    let status = 0;
    for (let i = 0; i <= LIMITS.authFailuresPer15Min; i++)
      status = (
        await call(
          hostA,
          "X".repeat(32) + ":" + "x".repeat(32),
          { jsonrpc: "2.0", id: 1, method: "ping" },
          "203.0.113.9",
        )
      ).status;
    expect(status).toBe(429);
  });

  it("logs metadata only: no page content, search terms or tokens", async () => {
    const spies = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "info"),
    ];
    await tool(hostA, TOKEN_A, "read_page", { page_id: 2 });
    await tool(hostA, TOKEN_A, "search", { query: "secret-search-term" });
    await tool(hostA, TOKEN_A, "read_page", { page_id: 999 });
    const rows = (
      await db.query("SELECT * FROM agent_activity WHERE tenant_id=$1", [
        tenantA,
      ])
    ).rows;
    expect(rows.length).toBeGreaterThan(0);
    const dump =
      JSON.stringify(rows) + JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const secret of [
      SECRET_WORDS,
      "secret-search-term",
      TOKEN_A,
      TOKEN_A.split(":")[1],
      "Hello team",
    ])
      expect(dump).not.toContain(secret);
    expect(
      rows.every(
        (r) =>
          r.target === null ||
          /^(page|book|shelf|attachment):\d+$/.test(r.target),
      ),
    ).toBe(true);
    spies.forEach((s) => s.mockRestore());
  });

  it("workspace llms.txt lists only what a logged-out visitor sees", async () => {
    const privateTxt = await workspaceLlmsTxt(
      { id: tenantA, team_id: null, slug: "a", host: hostA, running: true },
      fakeBookStack as typeof fetch,
    );
    expect(privateTxt).toContain(`https://${hostA}/mcp`);
    expect(privateTxt).toMatch(/does not publish any content/);
    for (const leaked of ["Welcome", "Salaries", SECRET_WORDS, "Hello team"])
      expect(privateTxt).not.toContain(leaked);
    const publicTxt = await workspaceLlmsTxt(
      { id: "b", team_id: null, slug: "b", host: hostB, running: true },
      fakeBookStack as typeof fetch,
    );
    expect(publicTxt).toContain("[Public book]");
    expect(publicTxt).toContain(
      `https://${hostB}/books/public-book/page/welcome/export/markdown`,
    );
    expect(publicTxt).not.toContain("B content");
  });
});
