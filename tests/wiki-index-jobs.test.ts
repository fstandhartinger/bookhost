import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: { query: vi.fn() } }));
vi.mock("@/lib/chat/indexing", () => ({ indexTenant: vi.fn() }));
import { encrypt } from "@/lib/intake/crypto";
import { indexTenant } from "@/lib/chat/indexing";
import { refreshWikiIndexes } from "@/lib/chat/wiki-index-jobs";

const TEAM_A = "11111111-1111-4111-8111-111111111111"; // operator allowlist
const TEAM_B = "22222222-2222-4222-8222-222222222222"; // opted in
const TEAM_C = "33333333-3333-4333-8333-333333333333"; // gate false, has chunks
const TEAM_D = "44444444-4444-4444-8444-444444444444"; // opted in, no workspace

type JobsState = {
  optedIn: string[];
  tenants: Record<string, { id: string; slug: string; host: null }>;
  secrets: Record<string, { api_id: string; api_secret_enc: string }>;
  chunkTeams: string[];
};

function jobsDb(state: JobsState) {
  const deleted: string[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("wiki_semantic_opt_in_at IS NOT NULL"))
      return { rows: state.optedIn.map((id) => ({ id })) };
    if (sql.includes("FROM tenants t")) {
      const tenant = state.tenants[values[0] as string];
      return { rows: tenant ? [tenant] : [] };
    }
    if (sql.includes("FROM tenant_secrets")) {
      const secret = state.secrets[values[0] as string];
      return { rows: secret ? [secret] : [] };
    }
    if (sql.includes("DISTINCT team_id"))
      return { rows: state.chunkTeams.map((team_id) => ({ team_id })) };
    if (sql.startsWith("DELETE FROM wiki_chunks")) {
      deleted.push(values[0] as string);
      return { rows: [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { query, deleted };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("INTAKE_KMS_KEY", "ab".repeat(32));
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM_A);
  vi.mocked(indexTenant).mockResolvedValue({
    teamId: "",
    status: "ok",
    pages: 0,
    chunks: 0,
    embedded: 0,
  } as never);
});

it("indexes allowlisted and opted-in teams and purges chunks of teams whose gate is false", async () => {
  const { query, deleted } = jobsDb({
    optedIn: [TEAM_B, TEAM_D],
    tenants: {
      [TEAM_A]: { id: "tenant-a", slug: "alpha", host: null },
      [TEAM_B]: { id: "tenant-b", slug: "beta", host: null },
    },
    secrets: {
      "tenant-a": {
        api_id: "id-a",
        api_secret_enc: encrypt("secret-a", "alpha"),
      },
      "tenant-b": {
        api_id: "id-b",
        api_secret_enc: encrypt("secret-b", "beta"),
      },
    },
    chunkTeams: [TEAM_A, TEAM_B, TEAM_C],
  });
  await refreshWikiIndexes({ query } as never);
  // The opted-in team without a running workspace is skipped, not indexed.
  expect(vi.mocked(indexTenant)).toHaveBeenCalledTimes(2);
  expect(vi.mocked(indexTenant).mock.calls.map((call) => call[1])).toEqual([
    TEAM_A,
    TEAM_B,
  ]);
  // Only the team whose gate is false loses its chunks.
  expect(deleted).toEqual([TEAM_C]);
});

it("indexes nothing and purges every team when the kill switch is off", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "");
  const { query, deleted } = jobsDb({
    optedIn: [TEAM_B],
    tenants: {
      [TEAM_A]: { id: "tenant-a", slug: "alpha", host: null },
    },
    secrets: {
      "tenant-a": {
        api_id: "id-a",
        api_secret_enc: encrypt("secret-a", "alpha"),
      },
    },
    chunkTeams: [TEAM_A, TEAM_B],
  });
  await refreshWikiIndexes({ query } as never);
  expect(indexTenant).not.toHaveBeenCalled();
  expect(deleted).toEqual([TEAM_A, TEAM_B]);
});

it("keeps the chunks of every team whose gate is open", async () => {
  const { query, deleted } = jobsDb({
    optedIn: [TEAM_B],
    tenants: {
      [TEAM_A]: { id: "tenant-a", slug: "alpha", host: null },
      [TEAM_B]: { id: "tenant-b", slug: "beta", host: null },
    },
    secrets: {
      "tenant-a": {
        api_id: "id-a",
        api_secret_enc: encrypt("secret-a", "alpha"),
      },
      "tenant-b": {
        api_id: "id-b",
        api_secret_enc: encrypt("secret-b", "beta"),
      },
    },
    chunkTeams: [TEAM_A, TEAM_B],
  });
  await refreshWikiIndexes({ query } as never);
  expect(vi.mocked(indexTenant)).toHaveBeenCalledTimes(2);
  expect(deleted).toEqual([]);
});
