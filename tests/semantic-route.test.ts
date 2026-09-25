import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("@/lib/intake/access", async (original) => ({
  ...(await original<typeof import("@/lib/intake/access")>()),
  workspace: vi.fn(),
  clientFor: vi.fn(),
}));
vi.mock("@/lib/chat/indexing", () => ({
  startWikiIndexBackfill: vi.fn(),
}));
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientFor, IntakeError, workspace } from "@/lib/intake/access";
import { startWikiIndexBackfill } from "@/lib/chat/indexing";
import { GET, POST } from "@/app/api/chat/semantic/route";

const TENANT = "44444444-4444-4444-8444-444444444444";
const TEAM = "55555555-5555-4555-8555-555555555555";

function stateDb(opts: { optedIn?: boolean; chunks?: number } = {}) {
  return async (sql: string) => {
    if (sql.includes("wiki_semantic_opt_in_at"))
      return {
        rows: opts.optedIn ? [{ wiki_semantic_opt_in_at: new Date() }] : [],
      };
    if (sql.includes("count(*)"))
      return { rows: [{ count: opts.chunks ?? 0 }] };
    return { rows: [] };
  };
}

const get = (tenantId: string) =>
  GET(new Request(`http://localhost/api/chat/semantic?tenantId=${tenantId}`));
const post = (payload: unknown) =>
  POST(
    new Request("http://localhost/api/chat/semantic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", "");
  vi.mocked(auth).mockResolvedValue({ user: { id: "user" } } as never);
  vi.mocked(workspace).mockResolvedValue({
    id: TENANT,
    team_id: TEAM,
    slug: "demo",
    role: "owner",
    subscription_status: "active",
  } as never);
  vi.mocked(clientFor).mockResolvedValue({} as never);
  vi.mocked(db.query).mockImplementation(stateDb() as never);
});

it("rejects anonymous callers on GET and POST", async () => {
  vi.mocked(auth).mockResolvedValue(null as never);
  expect((await get(TENANT)).status).toBe(401);
  expect((await post({ tenantId: TENANT, enabled: true })).status).toBe(401);
  expect(workspace).not.toHaveBeenCalled();
});

it("returns 404 for a workspace that is not the caller's", async () => {
  vi.mocked(workspace).mockRejectedValue(
    new IntakeError("Workspace not found.", 404),
  );
  expect((await get(TENANT)).status).toBe(404);
  expect((await post({ tenantId: TENANT, enabled: true })).status).toBe(404);
});

it("keeps the setting owner/admin only", async () => {
  vi.mocked(workspace).mockResolvedValue({
    id: TENANT,
    team_id: TEAM,
    slug: "demo",
    role: "member",
    subscription_status: "active",
  } as never);
  expect((await get(TENANT)).status).toBe(403);
  expect((await post({ tenantId: TENANT, enabled: true })).status).toBe(403);
});

it("reports the state to an owner", async () => {
  vi.mocked(db.query).mockImplementation(stateDb({}) as never);
  const response = await get(TENANT);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    enabled: false,
    source: "off",
    killSwitch: true,
    chunks: 0,
  });
});

it("reports an opted-in workspace as enabled by the workspace", async () => {
  vi.mocked(db.query).mockImplementation(stateDb({ optedIn: true, chunks: 7 }) as never);
  const response = await get(TENANT);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    enabled: true,
    source: "workspace",
    killSwitch: true,
    chunks: 7,
  });
});

it("reports an allowlisted workspace as enabled by the operator", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
  const response = await get(TENANT);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    enabled: true,
    source: "operator",
    killSwitch: true,
    chunks: 0,
  });
});

it("requires the no-personal-data confirmation to enable", async () => {
  const response = await post({ tenantId: TENANT, enabled: true });
  expect(response.status).toBe(400);
  expect(db.query).not.toHaveBeenCalledWith(
    expect.stringContaining("UPDATE teams"),
    [TEAM],
  );
  expect(startWikiIndexBackfill).not.toHaveBeenCalled();
});

it("rejects an enable for an operator-allowlisted team", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
  const response = await post({
    tenantId: TENANT,
    enabled: true,
    confirmNoPersonalData: true,
  });
  expect(response.status).toBe(409);
  expect(startWikiIndexBackfill).not.toHaveBeenCalled();
});

it("rejects an enable when the kill switch is off", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "");
  const response = await post({
    tenantId: TENANT,
    enabled: true,
    confirmNoPersonalData: true,
  });
  expect(response.status).toBe(409);
  expect(startWikiIndexBackfill).not.toHaveBeenCalled();
});

it("rejects a payload without a boolean enabled flag", async () => {
  expect((await post({ tenantId: TENANT })).status).toBe(400);
  expect((await post({ tenantId: TENANT, enabled: "yes" })).status).toBe(400);
});

it("enabling sets the opt-in column and starts the backfill once", async () => {
  const client = { base: "https://wiki.example" };
  vi.mocked(clientFor).mockResolvedValue(client as never);
  const response = await post({
    tenantId: TENANT,
    enabled: true,
    confirmNoPersonalData: true,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    enabled: true,
    source: "workspace",
  });
  expect(db.query).toHaveBeenCalledWith(
    "UPDATE teams SET wiki_semantic_opt_in_at=now() WHERE id=$1",
    [TEAM],
  );
  expect(clientFor).toHaveBeenCalledWith(
    expect.objectContaining({ id: TENANT }),
  );
  expect(startWikiIndexBackfill).toHaveBeenCalledTimes(1);
  expect(startWikiIndexBackfill).toHaveBeenCalledWith(client, TEAM);
});

it("disabling nulls the column and deletes exactly that team's chunks", async () => {
  const response = await post({ tenantId: TENANT, enabled: false });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    enabled: false,
    source: "off",
  });
  expect(db.query).toHaveBeenCalledWith(
    "UPDATE teams SET wiki_semantic_opt_in_at=NULL WHERE id=$1",
    [TEAM],
  );
  expect(db.query).toHaveBeenCalledWith(
    "DELETE FROM wiki_chunks WHERE team_id=$1",
    [TEAM],
  );
  expect(startWikiIndexBackfill).not.toHaveBeenCalled();
});
