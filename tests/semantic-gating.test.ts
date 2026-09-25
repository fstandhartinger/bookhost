import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("@/lib/chat/embeddings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chat/embeddings")>();
  return {
    ...original,
    embedTexts: vi.fn(),
    semanticEnabled: vi.fn(),
  };
});
import { embedTexts, semanticEnabled } from "@/lib/chat/embeddings";
import { indexTenant } from "@/lib/chat/indexing";
import {
  retrieveHybrid,
  type DbClient,
  type WikiClient,
} from "@/lib/chat/retrieval";

const TEAM = "11111111-1111-4111-8111-111111111111";
const QUESTION = "how do I deploy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(semanticEnabled).mockReset();
  vi.mocked(embedTexts).mockReset();
});

function unitVector(dim = 0): number[] {
  const vector = new Array<number>(1024).fill(0);
  vector[dim] = 1;
  return vector;
}

function emptyClient() {
  return {
    base: "https://wiki.example",
    request: vi.fn(),
  } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
}

it("indexTenant skips when the async gate is false, even with the env switch on", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
  vi.mocked(semanticEnabled).mockResolvedValue(false);
  const client = emptyClient();
  const report = await indexTenant(
    client,
    TEAM,
    { query: vi.fn(async () => ({ rows: [] })) } as DbClient,
  );
  expect(report.status).toBe("skipped");
  expect(client.request).not.toHaveBeenCalled();
  expect(embedTexts).not.toHaveBeenCalled();
});

it("indexTenant proceeds when the async gate is true", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.mocked(semanticEnabled).mockResolvedValue(true);
  vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
    texts.map(() => unitVector()),
  );
  const client = {
    base: "https://wiki.example",
    request: vi.fn(async (path: string) => {
      if (path.startsWith("books?")) return { data: [], total: 0 };
      if (path.startsWith("pages?count=500"))
        return {
          data: [{ id: 1, title: "Deploy handbook", book_id: null, slug: "deploy" }],
          total: 1,
        };
      if (path === "pages/1")
        return { id: 1, name: "Deploy handbook", html: "<p>alpha text</p>" };
      throw new Error(`unexpected path ${path}`);
    }),
  } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("SELECT page_id, chunk_ordinal")) return { rows: [] };
    if (sql.startsWith("DELETE FROM wiki_chunks")) return { rows: [] };
    if (sql.startsWith("INSERT INTO wiki_chunks")) return { rows: [] };
    throw new Error(`unexpected sql: ${sql}`);
  });
  const report = await indexTenant(client, TEAM, { query } as DbClient);
  expect(report.status).toBe("ok");
  expect(report.embedded).toBe(1);
  expect(embedTexts).toHaveBeenCalledTimes(1);
});

it("retrieveHybrid stays lexical when the async gate is false", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
  vi.mocked(semanticEnabled).mockResolvedValue(false);
  const client = emptyClient();
  vi.mocked(client.request).mockResolvedValue({ data: [] });
  const result = await retrieveHybrid(
    client,
    TEAM,
    QUESTION,
    { query: vi.fn(async () => ({ rows: [] })) } as DbClient,
  );
  expect(result.retrieval).toBe("lexical");
  expect(embedTexts).not.toHaveBeenCalled();
});

it("retrieveHybrid embeds when the async gate is true", async () => {
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.mocked(semanticEnabled).mockResolvedValue(true);
  vi.mocked(embedTexts).mockResolvedValue([unitVector()]);
  const client = emptyClient();
  vi.mocked(client.request).mockResolvedValue({ data: [] });
  const database = {
    query: vi.fn(async () => ({
      rows: [
        {
          page_id: 1,
          page_name: "Deploy handbook",
          book_id: null,
          section: "Setup",
          url: null,
          chunk: "Run the deploy script.",
          similarity: 0.9,
        },
      ],
    })),
  } as unknown as DbClient & { query: ReturnType<typeof vi.fn> };
  const result = await retrieveHybrid(client, TEAM, QUESTION, database);
  expect(result.retrieval).toBe("hybrid");
  expect(embedTexts).toHaveBeenCalledWith([QUESTION]);
  expect(result.passages[0]).toMatchObject({ pageId: 1, section: "Setup" });
});
