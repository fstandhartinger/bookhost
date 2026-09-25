import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
import { db } from "@/lib/db";
// The pg overloads type the mock's resolved value as void; loosen it here.
const query = vi.mocked(db.query) as unknown as ReturnType<typeof vi.fn>;
import {
  embeddingsEnabledForTenant,
  semanticEnabled,
  semanticTeamIds,
} from "@/lib/chat/embeddings";

const TEAM = "11111111-1111-4111-8111-111111111111";
const OTHER_TEAM = "22222222-2222-4222-8222-222222222222";
const THIRD_TEAM = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  vi.unstubAllEnvs();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("semanticEnabled", () => {
  it("is false when the kill switch is off, even for opted-in and allowlisted teams", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    query.mockResolvedValue({
      rows: [{ wiki_semantic_opt_in_at: new Date() }],
    });
    expect(await semanticEnabled(TEAM)).toBe(false);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is true for an allowlisted team without a database lookup", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    expect(await semanticEnabled(TEAM)).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("is true for an opted-in team", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", "");
    query.mockResolvedValue({
      rows: [{ wiki_semantic_opt_in_at: new Date() }],
    });
    expect(await semanticEnabled(TEAM)).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      "SELECT wiki_semantic_opt_in_at FROM teams WHERE id=$1",
      [TEAM],
    );
  });

  it("is false when the team is neither allowlisted nor opted in", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", OTHER_TEAM);
    query.mockResolvedValue({ rows: [] });
    expect(await semanticEnabled(TEAM)).toBe(false);
    // A row that lacks the opt-in column (e.g. an unrelated result set)
    // must not count as an opt-in.
    query.mockResolvedValue({ rows: [{ page_id: 1 }] });
    expect(await semanticEnabled(TEAM)).toBe(false);
  });

  it("fails closed on a database error", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", "");
    query.mockRejectedValue(new Error("db down"));
    expect(await semanticEnabled(TEAM)).toBe(false);
  });

  it("keeps the synchronous env-only function for existing consumers", () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    expect(embeddingsEnabledForTenant(TEAM)).toBe(true);
    expect(embeddingsEnabledForTenant(OTHER_TEAM)).toBe(false);
  });
});

describe("semanticTeamIds", () => {
  it("returns the de-duplicated union of allowlist and opted-in teams", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", `${OTHER_TEAM}, ${TEAM}`);
    query.mockResolvedValue({
      rows: [
        { id: TEAM },
        { id: THIRD_TEAM },
        { id: "not-a-string" },
      ],
    });
    expect(await semanticTeamIds()).toEqual([OTHER_TEAM, TEAM, THIRD_TEAM]);
  });

  it("is empty when the kill switch is off", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    query.mockResolvedValue({ rows: [{ id: TEAM }] });
    expect(await semanticTeamIds()).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("keeps the allowlist only when the database errors", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    query.mockRejectedValue(new Error("db down"));
    expect(await semanticTeamIds()).toEqual([TEAM]);
  });
});
