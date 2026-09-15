import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { htmlToSections, type DbClient, type WikiClient } from "./retrieval";
import { embedTexts, embeddingsEnabledForTenant } from "./embeddings";

const MAX_CHUNK_CHARS = 1200;

export type Chunk = {
  heading: string | null;
  text: string;
};

/**
 * Chunk a page the same way retrieval reads it: one chunk per section, the
 * heading prefixed to the body, capped so a single chunk stays embeddable.
 */
export function chunksOf(page: { name: string; html: string }): Chunk[] {
  const sections = htmlToSections(page.html);
  const candidates = sections.length
    ? sections
    : [
        {
          heading: null as string | null,
          text: page.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        },
      ];
  return candidates
    .map((section) => ({
      heading: section.heading,
      text: `${section.heading ? `${section.heading}\n` : ""}${section.text}`.slice(
        0,
        MAX_CHUNK_CHARS,
      ),
    }))
    .filter((chunk) => chunk.text.trim());
}

export function contentHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type IndexReport = {
  teamId: string;
  status: "ok" | "skipped" | "error";
  pages: number;
  chunks: number;
  embedded: number;
  error?: string;
};

type StoredChunk = {
  page_id: number;
  chunk_ordinal: number;
  content_hash: string;
  embedding: string | null;
};

type PageSummary = {
  id: number;
  name: string;
  bookId: number | null;
  url: string | null;
};

type PageDetail = {
  id: number;
  name?: string;
  html?: string;
  book_id?: number;
};

/** Same paged listing loop as BookStack.list: 500 per page, bounded. */
async function listPages(client: WikiClient): Promise<PageSummary[]> {
  const all: PageSummary[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await client.request<{
      data?: {
        id?: number;
        title?: string;
        name?: string;
        book_id?: number;
        chapter_id?: number | null;
        slug?: string;
      }[];
      total?: number;
    }>(`pages?count=500&offset=${offset}`);
    const data = result.data || [];
    for (const page of data) {
      const name = page.title || page.name;
      if (typeof page.id !== "number" || !Number.isSafeInteger(page.id) || !name)
        continue;
      const bookId =
        typeof page.book_id === "number" && Number.isSafeInteger(page.book_id)
          ? page.book_id
          : null;
      const chapterId =
        typeof page.chapter_id === "number" && Number.isSafeInteger(page.chapter_id)
          ? page.chapter_id
          : null;
      all.push({
        id: page.id,
        name,
        bookId,
        url: page.slug
          ? bookId
            ? `/books/${bookId}/page/${page.slug}`
            : chapterId
              ? `/chapters/${chapterId}/page/${page.slug}`
              : null
          : null,
      });
    }
    const total = result.total ?? data.length;
    if (all.length >= total || !data.length) return all;
    if (offset >= 9500) throw new Error("Too many pages to index.");
  }
}

/**
 * Rebuild one tenant's chunk index. Only chunks whose content hash changed
 * are re-embedded; rows for pages that disappeared are deleted. Errors are
 * reported, never raised, and a persistent embedding failure leaves the old
 * rows in place.
 */
export async function indexTenant(
  client: WikiClient,
  teamId: string,
  database: DbClient = db,
): Promise<IndexReport> {
  const report: IndexReport = {
    teamId,
    status: "error",
    pages: 0,
    chunks: 0,
    embedded: 0,
  };
  if (!embeddingsEnabledForTenant(teamId)) {
    report.status = "skipped";
    return report;
  }
  try {
    const pages = await listPages(client);
    report.pages = pages.length;
    const details = await Promise.allSettled(
      pages.map((page) => client.request<PageDetail>(`pages/${page.id}`)),
    );
    const fetched: { page: PageSummary; html: string }[] = [];
    pages.forEach((page, index) => {
      const detail = details[index];
      if (detail.status === "fulfilled" && detail.value.html)
        fetched.push({ page, html: detail.value.html });
    });
    if (pages.length && !fetched.length) {
      report.error = "No wiki pages could be read; index left unchanged.";
      return report;
    }
    type Desired = {
      page: PageSummary;
      ordinal: number;
      chunk: string;
      hash: string;
      section: string | null;
    };
    const desired: Desired[] = [];
    for (const { page, html } of fetched) {
      chunksOf({ name: page.name, html }).forEach((chunk, ordinal) => {
        desired.push({
          page,
          ordinal,
          chunk: chunk.text,
          hash: contentHash(chunk.text),
          section: chunk.heading,
        });
      });
    }
    report.chunks = desired.length;
    const stored = new Map<string, StoredChunk>(
      (
        await database.query(
          "SELECT page_id, chunk_ordinal, content_hash, embedding FROM wiki_chunks WHERE team_id=$1",
          [teamId],
        )
      ).rows.map((row) => [
        `${row.page_id}:${row.chunk_ordinal}`,
        row as unknown as StoredChunk,
      ]),
    );
    const changed = desired.filter(
      (item) =>
        stored.get(`${item.page.id}:${item.ordinal}`)?.content_hash !== item.hash,
    );
    let vectors: number[][] | null = null;
    if (changed.length) {
      vectors = await embedTexts(changed.map((item) => item.chunk));
      if (!vectors)
        vectors = await embedTexts(changed.map((item) => item.chunk));
      if (!vectors) {
        report.error = "Embedding provider unavailable; index left unchanged.";
        return report;
      }
      report.embedded = changed.length;
    }
    // Pages that vanished from the wiki lose their rows; a page that is still
    // listed but could not be fetched keeps its old rows (conservative).
    await database.query(
      "DELETE FROM wiki_chunks WHERE team_id=$1 AND page_id <> ALL($2::int[])",
      [teamId, pages.map((page) => page.id)],
    );
    for (const { page } of fetched) {
      const ordinals = desired
        .filter((item) => item.page.id === page.id)
        .map((item) => item.ordinal);
      await database.query(
        "DELETE FROM wiki_chunks WHERE team_id=$1 AND page_id=$2 AND chunk_ordinal <> ALL($3::int[])",
        [teamId, page.id, ordinals],
      );
    }
    for (const item of desired) {
      const previous = stored.get(`${item.page.id}:${item.ordinal}`);
      const unchanged =
        previous?.content_hash === item.hash && previous.embedding !== null;
      const embedding = unchanged
        ? previous.embedding
        : JSON.stringify(vectors![changed.indexOf(item)]);
      await database.query(
        `INSERT INTO wiki_chunks (team_id,page_id,page_name,book_id,section,url,chunk_ordinal,chunk,content_hash,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (team_id,page_id,chunk_ordinal)
         DO UPDATE SET page_name=$11,book_id=$12,section=$13,url=$14,chunk=$15,content_hash=$16,embedding=$17,updated_at=now()`,
        [
          teamId,
          item.page.id,
          item.page.name,
          item.page.bookId,
          item.section,
          item.page.url,
          item.ordinal,
          item.chunk,
          item.hash,
          embedding,
          item.page.name,
          item.page.bookId,
          item.section,
          item.page.url,
          item.chunk,
          item.hash,
          embedding,
        ],
      );
    }
    report.status = "ok";
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : "Indexing failed.";
    return report;
  }
}

const globalIndex = globalThis as unknown as {
  wikiIndexRunning?: Set<string>;
};

/**
 * Fire-and-forget backfill for a gated tenant whose index is missing or
 * empty. One run per tenant at a time, in-process; the answer request that
 * triggered it proceeds on the lexical path meanwhile.
 */
export function startWikiIndexBackfill(client: WikiClient, teamId: string) {
  if (!embeddingsEnabledForTenant(teamId)) return;
  const running = (globalIndex.wikiIndexRunning ??= new Set<string>());
  if (running.has(teamId)) return;
  running.add(teamId);
  void indexTenant(client, teamId)
    .catch(() => {})
    .finally(() => running.delete(teamId));
}
