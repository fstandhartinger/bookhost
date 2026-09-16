import { afterEach, describe, expect, it, vi } from "vitest";
import {
  retrieve,
  retrieveHybrid,
  scoreSection,
  vectorSearch,
  queryTerms,
  type DbClient,
  type WikiClient,
} from "@/lib/chat/retrieval";
import {
  embedTexts,
  embeddingsEnabledForTenant,
  truncateAndRenormalise,
} from "@/lib/chat/embeddings";
import { chunksOf, contentHash, indexTenant } from "@/lib/chat/indexing";
import { askWiki } from "@/lib/chat/ask";

// embedTexts is spied so indexing tests can prove which chunks were sent to
// the provider; by default the spy runs the real implementation against a
// stubbed global fetch, so no live provider is ever reached.
vi.mock("@/lib/chat/embeddings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chat/embeddings")>();
  return { ...original, embedTexts: vi.fn(original.embedTexts) };
});
const realEmbedTexts = vi.mocked(embedTexts).getMockImplementation()!;

const TEAM = "11111111-1111-4111-8111-111111111111";
const OTHER_TEAM = "22222222-2222-4222-8222-222222222222";
const QUESTION = "how do I deploy";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(embedTexts).mockClear();
  vi.mocked(embedTexts).mockImplementation(realEmbedTexts);
});

function openGate(teamId: string = TEAM) {
  vi.stubEnv("WIKI_EMBEDDINGS", "1");
  vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", teamId);
  vi.stubEnv("TENSORX_API_KEY", "test-key");
}

function unitVector(dim = 0): number[] {
  const vector = new Array<number>(1024).fill(0);
  vector[dim] = 1;
  return vector;
}

function stubEmbeddingFetch(vector: number[]) {
  const fetchSpy = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/embeddings"))
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: vector }] }),
        { status: 200 },
      );
    throw new Error(`unexpected outbound call: ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function fakeDb(rows: Record<string, unknown>[] = []): DbClient & {
  query: ReturnType<typeof vi.fn>;
} {
  return { query: vi.fn(async () => ({ rows })) };
}

/** A db mock that filters like a real one: only the bound $1 tenant matches. */
function tenantDb(allRows: Record<string, unknown>[]): DbClient & {
  query: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async (_sql: string, values: unknown[] = []) => ({
      rows: allRows.filter((row) => row.team_id === values[0]),
    })),
  };
}

// Five chunks across two pages. Three distractors share the lexical token
// "deploy" with the question; the Rotation target shares none of its terms.
const PAGE_1 = {
  id: 1,
  name: "Deploy handbook",
  book_id: 5,
  html: "<h2>Setup</h2><p>Run the deploy script before every release.</p><h2>Rollback</h2><p>Roll back a deploy with the undo command.</p>",
};
const PAGE_2 = {
  id: 2,
  name: "Credentials",
  book_id: 6,
  html: "<h2>Storage</h2><p>The deploy token lives in the vault.</p><h2>Rotation</h2><p>Rotate the credentials every ninety days.</p><h2>Access</h2><p>Request access from the on-call engineer.</p>",
};

function wikiClient(): WikiClient & { request: ReturnType<typeof vi.fn> } {
  return {
    base: "https://wiki.example",
    request: vi.fn(async (path: string) => {
      if (path.startsWith("search"))
        return {
          data: [
            { id: 1, name: "Deploy handbook", type: "page", url: "/books/handbook/page/deploy" },
            { id: 2, name: "Credentials", type: "page", url: "/books/handbook/page/credentials" },
          ],
        };
      if (path === "pages/1") return PAGE_1;
      if (path === "pages/2") return PAGE_2;
      throw new Error(`unexpected path ${path}`);
    }),
  } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
}

const TARGET_ROW = {
  page_id: 2,
  page_name: "Credentials",
  book_id: 6,
  section: "Rotation",
  url: "/books/6/page/credentials",
  chunk: "Rotation\nRotate the credentials every ninety days.",
  similarity: 0.9,
};
const SEED_ROWS = [
  TARGET_ROW,
  { page_id: 1, page_name: "Deploy handbook", book_id: 5, section: "Setup", url: "/books/5/page/deploy", chunk: "Setup\nRun the deploy script before every release.", similarity: 0.55 },
  { page_id: 1, page_name: "Deploy handbook", book_id: 5, section: "Rollback", url: "/books/5/page/deploy", chunk: "Rollback\nRoll back a deploy with the undo command.", similarity: 0.5 },
  { page_id: 2, page_name: "Credentials", book_id: 6, section: "Storage", url: "/books/6/page/credentials", chunk: "Storage\nThe deploy token lives in the vault.", similarity: 0.45 },
  { page_id: 2, page_name: "Credentials", book_id: 6, section: "Access", url: "/books/6/page/credentials", chunk: "Access\nRequest access from the on-call engineer.", similarity: 0.29 },
];

describe("hybrid retrieval", () => {
  it("ranks the semantically closest chunk first where lexical scoring is blind (A3)", async () => {
    openGate();
    stubEmbeddingFetch(unitVector());
    const result = await retrieveHybrid(
      wikiClient(),
      TEAM,
      QUESTION,
      fakeDb(SEED_ROWS),
    );
    expect(result.retrieval).toBe("hybrid");
    expect(result.passages[0]).toMatchObject({ pageId: 2, section: "Rotation" });
    expect(result.passages[0].score - result.passages[1].score).toBeGreaterThanOrEqual(0.05);
    // the lexical path alone never sees the target
    const lexical = await retrieve(wikiClient(), QUESTION);
    expect(lexical.some((passage) => passage.section === "Rotation")).toBe(false);
    expect(
      scoreSection(
        "Rotation",
        "Rotate the credentials every ninety days.",
        queryTerms(QUESTION),
      ),
    ).toBe(0);
  });

  it("keeps the lexical order when every vector is identical (A3 negative control)", async () => {
    openGate();
    stubEmbeddingFetch(unitVector());
    // Seeded in lexical order; constant vectors create no semantic margin.
    const flat = [SEED_ROWS[1], SEED_ROWS[2], SEED_ROWS[3], SEED_ROWS[0], SEED_ROWS[4]].map(
      (row) => ({ ...row, similarity: 0.5 }),
    );
    const result = await retrieveHybrid(
      wikiClient(),
      TEAM,
      QUESTION,
      fakeDb(flat),
    );
    expect(result.retrieval).toBe("hybrid");
    expect(Math.abs(result.passages[0].score - result.passages[1].score)).toBeLessThan(0.05);
    expect(result.passages.slice(0, 3).map((passage) => passage.section)).toEqual([
      "Setup",
      "Rollback",
      "Storage",
    ]);
  });

  it("degrades to the identical lexical answer when the embedder fails (A4)", async () => {
    openGate();
    const fetchSpy = vi.fn(
      async () => new Response("provider down", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const withTeam = await askWiki(wikiClient(), QUESTION, {
      teamId: TEAM,
      database: fakeDb(SEED_ROWS),
    });
    const baseline = await askWiki(wikiClient(), QUESTION);
    expect(withTeam.retrieval).toBe("lexical");
    expect(withTeam.mode).toBe("extractive");
    expect(withTeam.refused).toBe(false);
    expect(withTeam.answer).toBe(baseline.answer);
    expect(withTeam.sources).toEqual(baseline.sources);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // one retry, then degrade
  });

  it("never returns another tenant's rows and binds team_id as a parameter (A5)", async () => {
    const database = tenantDb([
      { team_id: TEAM, page_id: 1, page_name: "A page", book_id: null, section: "S", url: null, chunk: "alpha", similarity: 0.9 },
      { team_id: OTHER_TEAM, page_id: 1, page_name: "B page", book_id: null, section: "S", url: null, chunk: "beta", similarity: 0.9 },
    ]);
    const hits = await vectorSearch(database, TEAM, unitVector(), 8);
    expect(hits).toHaveLength(1);
    expect(hits[0].page_name).toBe("A page");
    const [sql, values] = database.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("team_id=$1");
    expect(sql).not.toContain(TEAM);
    expect(values[0]).toBe(TEAM);
    expect(values[1]).toBe(JSON.stringify(unitVector()));
  });
});

describe("indexing", () => {
  type StoredRow = {
    team_id: string;
    page_id: number;
    page_name: string;
    book_id: number | null;
    section: string | null;
    url: string | null;
    chunk_ordinal: number;
    chunk: string;
    content_hash: string;
    embedding: string | null;
  };

  function fakeChunkDb() {
    const store = new Map<string, StoredRow>();
    const key = (team: string, page: number, ordinal: number) =>
      `${team}:${page}:${ordinal}`;
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT page_id, chunk_ordinal, content_hash, embedding")) {
        const team = values[0] as string;
        return {
          rows: [...store.values()]
            .filter((row) => row.team_id === team)
            .map((row) => ({
              page_id: row.page_id,
              chunk_ordinal: row.chunk_ordinal,
              content_hash: row.content_hash,
              embedding: row.embedding,
            })),
        };
      }
      if (sql.startsWith("DELETE FROM wiki_chunks WHERE team_id=$1 AND page_id <> ALL")) {
        const [team, keep] = values as [string, number[]];
        for (const [k, row] of [...store])
          if (row.team_id === team && !keep.includes(row.page_id)) store.delete(k);
        return { rows: [] };
      }
      if (sql.startsWith("DELETE FROM wiki_chunks WHERE team_id=$1 AND page_id=$2")) {
        const [team, page, ordinals] = values as [string, number, number[]];
        for (const [k, row] of [...store])
          if (row.team_id === team && row.page_id === page && !ordinals.includes(row.chunk_ordinal))
            store.delete(k);
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO wiki_chunks")) {
        const [team, pageId, pageName, bookId, section, url, ordinal, chunk, hash, embedding] =
          values as [
            string,
            number,
            string,
            number | null,
            string | null,
            string | null,
            number,
            string,
            string,
            string | null,
          ];
        store.set(key(team, pageId, ordinal), {
          team_id: team,
          page_id: pageId,
          page_name: pageName,
          book_id: bookId,
          section,
          url,
          chunk_ordinal: ordinal,
          chunk,
          content_hash: hash,
          embedding,
        });
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    });
    return { store, database: { query } as DbClient };
  }

  function indexingClient(
    pages: Record<number, { title: string; book_id?: number; slug?: string }>,
    htmls: Record<number, string>,
    books: Record<number, { slug: string }> = {},
  ): WikiClient {
    return {
      base: "https://wiki.example",
      request: vi.fn(async (path: string) => {
        if (path.startsWith("books?count=500")) {
          const data = Object.entries(books).map(([id, book]) => ({
            id: Number(id),
            slug: book.slug,
          }));
          return { data, total: data.length };
        }
        if (path.startsWith("pages?count=500")) {
          const data = Object.entries(pages).map(([id, page]) => ({
            id: Number(id),
            title: page.title,
            book_id: page.book_id,
            slug: page.slug,
          }));
          return { data, total: data.length };
        }
        const match = path.match(/^pages\/(\d+)$/);
        const id = match ? Number(match[1]) : NaN;
        if (Number.isSafeInteger(id) && htmls[id] !== undefined)
          return { id, name: pages[id].title, html: htmls[id] };
        throw new Error(`unexpected path ${path}`);
      }),
    } as unknown as WikiClient;
  }

  function fakeVector(text: string): number[] {
    const vector = new Array<number>(1024).fill(0);
    let h = 0;
    for (const ch of text) h = (h * 31 + (ch.codePointAt(0) || 0)) % 1024;
    vector[h] = 1;
    return vector;
  }

  it("re-embeds only changed chunks and deletes vanished pages (A6)", async () => {
    openGate();
    const { store, database } = fakeChunkDb();
    const client = indexingClient(
      {
        1: { title: "Deploy handbook", book_id: 5, slug: "deploy" },
        2: { title: "Credentials", book_id: 6, slug: "credentials" },
        3: { title: "Legacy", book_id: 7, slug: "legacy" },
      },
      {
        1: "<h2>One</h2><p>alpha text</p><h2>Two</h2><p>beta text</p>",
        2: "<p>gamma text</p>",
        3: "<p>delta text</p>",
      },
    );
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(fakeVector),
    );
    const first = await indexTenant(client, TEAM, database);
    expect(first.status).toBe("ok");
    expect(first.embedded).toBe(4);
    expect(store.size).toBe(4);
    const page1Before = store.get(`${TEAM}:1:0`)!;
    const page1SecondBefore = store.get(`${TEAM}:1:1`)!;
    const page2Before = store.get(`${TEAM}:2:0`)!;

    const client2 = indexingClient(
      {
        1: { title: "Deploy handbook", book_id: 5, slug: "deploy" },
        2: { title: "Credentials", book_id: 6, slug: "credentials" },
      },
      {
        1: "<h2>One</h2><p>alpha text changed</p><h2>Two</h2><p>beta text</p>",
        2: "<p>gamma text</p>",
      },
    );
    const second = await indexTenant(client2, TEAM, database);
    expect(second.status).toBe("ok");
    expect(second.embedded).toBe(1);
    // only the changed chunk went to the embedder, in both runs combined
    expect(vi.mocked(embedTexts)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(embedTexts).mock.calls[1][0]).toEqual([
      "One\nalpha text changed",
    ]);
    // the changed chunk got a new hash and a new embedding row
    const page1After = store.get(`${TEAM}:1:0`)!;
    expect(page1After.content_hash).not.toBe(page1Before.content_hash);
    expect(page1After.embedding).not.toBe(page1Before.embedding);
    // the unchanged chunk of the changed page kept its row
    const page1SecondAfter = store.get(`${TEAM}:1:1`)!;
    expect(page1SecondAfter.content_hash).toBe(page1SecondBefore.content_hash);
    expect(page1SecondAfter.embedding).toBe(page1SecondBefore.embedding);
    // the unchanged page kept its exact embedding content
    const page2After = store.get(`${TEAM}:2:0`)!;
    expect(page2After.content_hash).toBe(page2Before.content_hash);
    expect(page2After.embedding).toBe(page2Before.embedding);
    // the deleted page is gone
    expect(store.has(`${TEAM}:3:0`)).toBe(false);
    expect(store.size).toBe(3);
  });

  it("stores slug-based citation URLs and null for unknown books (A19)", async () => {
    openGate();
    const { store, database } = fakeChunkDb();
    const client = indexingClient(
      {
        1: { title: "Deploy handbook", book_id: 5, slug: "deploy" },
        2: { title: "Credentials", book_id: 6, slug: "credentials" },
        3: { title: "Orphan", book_id: 9, slug: "orphan" },
      },
      {
        1: "<p>alpha text</p>",
        2: "<p>gamma text</p>",
        3: "<p>delta text</p>",
      },
      {
        5: { slug: "handbook" },
        6: { slug: "secrets" },
      },
    );
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(fakeVector),
    );
    const report = await indexTenant(client, TEAM, database);
    expect(report.status).toBe("ok");
    expect(store.size).toBe(3);
    // every stored URL is the real BookStack page route, slug-based
    expect(store.get(`${TEAM}:1:0`)!.url).toBe("/books/handbook/page/deploy");
    expect(store.get(`${TEAM}:2:0`)!.url).toBe("/books/secrets/page/credentials");
    // a page whose book is missing from the books listing gets no URL
    expect(store.get(`${TEAM}:3:0`)!.url).toBeNull();
    for (const row of store.values())
      expect(row.url ?? "").not.toMatch(/^\/books\/\d+\/page\//);
  });

  it("re-embeds a NULL-embedding row and then no-ops cleanly (A19)", async () => {
    openGate();
    const { store, database } = fakeChunkDb();
    const html = "<p>gamma text</p>";
    const client = indexingClient(
      { 1: { title: "Credentials", book_id: 6, slug: "credentials" } },
      { 1: html },
      { 6: { slug: "secrets" } },
    );
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(fakeVector),
    );
    // an operator forces a re-embed by NULLing the embedding while the
    // content hash still matches
    const chunk = chunksOf({ name: "Credentials", html })[0];
    store.set(`${TEAM}:1:0`, {
      team_id: TEAM,
      page_id: 1,
      page_name: "Credentials",
      book_id: 6,
      section: null,
      url: "/books/secrets/page/credentials",
      chunk_ordinal: 0,
      chunk: chunk.text,
      content_hash: contentHash(chunk.text),
      embedding: null,
    });
    const first = await indexTenant(client, TEAM, database);
    expect(first.status).toBe("ok");
    expect(first.error).toBeUndefined();
    expect(first.embedded).toBe(1);
    expect(store.get(`${TEAM}:1:0`)!.embedding).not.toBeNull();
    const second = await indexTenant(client, TEAM, database);
    expect(second.status).toBe("ok");
    expect(second.error).toBeUndefined();
    expect(second.embedded).toBe(0);
    for (const row of store.values()) expect(row.embedding).not.toBeNull();
    // the NULL row was re-embedded exactly once, across both runs
    expect(vi.mocked(embedTexts)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embedTexts).mock.calls[0][0]).toEqual(["gamma text"]);
  });

  it("still indexes with null URLs when the books listing fails (A19)", async () => {
    openGate();
    const { store, database } = fakeChunkDb();
    const request = vi.fn(async (path: string) => {
      if (path.startsWith("books?"))
        throw new Error("books endpoint down");
      if (path.startsWith("pages?count=500"))
        return {
          data: [
            { id: 1, title: "Deploy handbook", book_id: 5, slug: "deploy" },
            { id: 2, title: "Credentials", book_id: 6, slug: "credentials" },
          ],
          total: 2,
        };
      const match = path.match(/^pages\/(\d+)$/);
      const id = match ? Number(match[1]) : NaN;
      if (id === 1)
        return { id: 1, name: "Deploy handbook", html: "<p>alpha text</p>" };
      if (id === 2)
        return { id: 2, name: "Credentials", html: "<p>gamma text</p>" };
      throw new Error(`unexpected path ${path}`);
    });
    const client = {
      base: "https://wiki.example",
      request,
    } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(fakeVector),
    );
    // the failing books listing must not abort the run
    const report = await indexTenant(client, TEAM, database);
    expect(report.status).toBe("ok");
    expect(report.error).toBeUndefined();
    expect(report.pages).toBe(2);
    expect(report.chunks).toBe(2);
    expect(store.size).toBe(2);
    // without book slugs no URL can be built: every citation is null,
    // never a numeric-id link
    for (const row of store.values()) expect(row.url).toBeNull();
    expect(request).toHaveBeenCalledWith("books?count=500&offset=0");
  });

  it("resolves book slugs from a second books page (A19)", async () => {
    openGate();
    const { store, database } = fakeChunkDb();
    const firstBatch = Array.from({ length: 500 }, (_, i) => ({
      id: i + 1,
      slug: `book-${i + 1}`,
    }));
    const secondBatch = [
      { id: 501, slug: "alpha-late" },
      { id: 502, slug: "beta-late" },
      { id: 503, slug: "target-book" },
    ];
    const request = vi.fn(async (path: string) => {
      if (path.startsWith("books?count=500")) {
        if (path.endsWith("offset=0"))
          return { data: firstBatch, total: 503 };
        if (path.endsWith("offset=500"))
          return { data: secondBatch, total: 503 };
        throw new Error(`unexpected books path ${path}`);
      }
      if (path.startsWith("pages?count=500"))
        return {
          data: [
            { id: 1, title: "Deploy handbook", book_id: 503, slug: "deploy" },
          ],
          total: 1,
        };
      const match = path.match(/^pages\/(\d+)$/);
      const id = match ? Number(match[1]) : NaN;
      if (id === 1)
        return { id: 1, name: "Deploy handbook", html: "<p>alpha text</p>" };
      throw new Error(`unexpected path ${path}`);
    });
    const client = {
      base: "https://wiki.example",
      request,
    } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
    vi.mocked(embedTexts).mockImplementation(async (texts: string[]) =>
      texts.map(fakeVector),
    );
    const report = await indexTenant(client, TEAM, database);
    expect(report.status).toBe("ok");
    expect(report.pages).toBe(1);
    // the page's book only exists in the second batch, so the loop must
    // have followed the pagination to find its slug
    expect(store.get(`${TEAM}:1:0`)!.url).toBe("/books/target-book/page/deploy");
    expect(request).toHaveBeenCalledWith("books?count=500&offset=500");
  });

  it("prefixes the heading, caps at 1200 chars and skips empty sections", () => {
    expect(
      chunksOf({ name: "P", html: "<h2>Head</h2><p>body</p><h2>Empty</h2>" }),
    ).toEqual([{ heading: "Head", text: "Head\nbody" }]);
    const long = chunksOf({
      name: "P",
      html: `<h2>Head</h2><p>${"x".repeat(2000)}</p>`,
    });
    expect(long[0].text).toHaveLength(1200);
    expect(chunksOf({ name: "P", html: "<p></p>" })).toEqual([]);
  });
});

describe("tenant gate", () => {
  it("makes zero outbound calls when the feature switch is off (A10)", async () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", TEAM);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = {
      base: "https://wiki.example",
      request: vi.fn(),
    } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
    const report = await indexTenant(client, TEAM, fakeDb());
    expect(report.status).toBe("skipped");
    expect(await embedTexts(["hello"])).toBeNull();
    const result = await retrieveHybrid(
      wikiClient(),
      TEAM,
      QUESTION,
      fakeDb(SEED_ROWS),
    );
    expect(result.retrieval).toBe("lexical");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("makes zero outbound calls for a tenant that is not on the list (A10)", async () => {
    openGate(OTHER_TEAM);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const client = {
      base: "https://wiki.example",
      request: vi.fn(),
    } as unknown as WikiClient & { request: ReturnType<typeof vi.fn> };
    const report = await indexTenant(client, TEAM, fakeDb());
    expect(report.status).toBe("skipped");
    const result = await retrieveHybrid(
      wikiClient(),
      TEAM,
      QUESTION,
      fakeDb(SEED_ROWS),
    );
    expect(result.retrieval).toBe("lexical");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("calls the provider when the gate is open for the tenant (A10)", async () => {
    openGate();
    const fetchSpy = stubEmbeddingFetch(unitVector());
    const result = (await embedTexts(["hello"]))!;
    expect(result).not.toBeNull();
    expect(result[0]).toHaveLength(1024);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe("https://api.tensorx.ai/v1/embeddings");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "qwen/qwen3-embedding-8b",
      input: ["hello"],
    });
  });

  it("matches the tenant list exactly, trimmed, without wildcards", () => {
    vi.stubEnv("WIKI_EMBEDDINGS", "1");
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", ` ${OTHER_TEAM} , ${TEAM} `);
    expect(embeddingsEnabledForTenant(TEAM)).toBe(true);
    expect(embeddingsEnabledForTenant(OTHER_TEAM)).toBe(true);
    expect(embeddingsEnabledForTenant(TEAM.slice(0, -1))).toBe(false);
    vi.stubEnv("WIKI_EMBEDDINGS_TENANTS", "*");
    expect(embeddingsEnabledForTenant(TEAM)).toBe(false);
  });
});

describe("truncate and renormalise", () => {
  it("reduces 4096 dims to 1024 with unit norm and preserved direction", () => {
    const original = new Array<number>(4096).fill(0);
    for (let i = 0; i < 1024; i++) original[i] = (i % 5) * 0.25;
    original[2048] = 9; // mass beyond the truncation point is dropped
    const result = truncateAndRenormalise(original)!;
    expect(result).toHaveLength(1024);
    const norm = Math.sqrt(result.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    // direction of the kept part is preserved: cosine with the truncated
    // original is 1, so the dot product is the truncated norm.
    const dot = result.reduce((sum, x, i) => sum + x * original[i], 0);
    expect(dot).toBeGreaterThan(0.99);
  });

  it("rejects zero and non-finite vectors", () => {
    expect(truncateAndRenormalise(new Array(1024).fill(0))).toBeNull();
    const tailOnly = new Array(4096).fill(0);
    tailOnly[3000] = 1; // nothing left after truncation
    expect(truncateAndRenormalise(tailOnly)).toBeNull();
    expect(truncateAndRenormalise([1, Number.NaN, 0])).toBeNull();
  });
});
