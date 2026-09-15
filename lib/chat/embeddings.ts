// Semantic embeddings for wiki chat. The provider is an OpenAI-compatible
// endpoint (TensorX by default). Failures degrade to the lexical path: this
// module never throws and never logs credentials.

const BATCH_SIZE = 8;
const RETRY_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;

/** The HNSW index caps at 2000 dims; the provider emits 4096 and ignores the
 *  `dimensions` parameter, so we store the first 1024 dims, re-normalised. */
export const EMBEDDING_DIMENSIONS = 1024;

export function embeddingsConfig() {
  const base = (
    process.env.WIKI_EMBEDDINGS_BASE_URL || "https://api.tensorx.ai/v1"
  ).replace(/\/+$/, "");
  const model = process.env.WIKI_EMBEDDINGS_MODEL || "qwen/qwen3-embedding-8b";
  return { base, model };
}

/** The QA-tenant gate: an exact, trimmed, comma-separated list. No wildcard. */
export function embeddingsTenantIds() {
  return (process.env.WIKI_EMBEDDINGS_TENANTS || "")
    .split(",")
    .map((teamId) => teamId.trim())
    .filter(Boolean);
}

export function embeddingsEnabledForTenant(teamId: string) {
  if (process.env.WIKI_EMBEDDINGS !== "1" || !teamId) return false;
  return embeddingsTenantIds().includes(teamId);
}

/** Keep the first 1024 dims and restore unit length (cosine distance). A
 *  zero or non-finite norm means the provider sent garbage: reject it. */
export function truncateAndRenormalise(vector: number[]): number[] | null {
  const truncated = vector.slice(0, EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (const value of truncated) {
    if (!Number.isFinite(value)) return null;
    norm += value * value;
  }
  if (norm <= 0) return null;
  norm = Math.sqrt(norm);
  return truncated.map((value) => value / norm);
}

type EmbeddingEntry = { index?: unknown; embedding?: unknown };

async function embedBatch(
  texts: string[],
  key: string,
): Promise<number[][] | null> {
  const { base, model } = embeddingsConfig();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0)
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    try {
      const response = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      const value = (await response.json()) as { data?: EmbeddingEntry[] };
      const data = value.data;
      if (!Array.isArray(data) || data.length !== texts.length) continue;
      const ordered = data
        .map((entry, position) => ({
          embedding: entry?.embedding,
          index: Number.isInteger(entry?.index) ? (entry.index as number) : position,
        }))
        .sort((a, b) => a.index - b.index);
      const vectors = ordered.map(
        (entry) =>
          Array.isArray(entry.embedding) &&
          entry.embedding.every((dim): dim is number => Number.isFinite(dim))
            ? (entry.embedding as number[])
            : null,
      );
      const complete = vectors.filter((vector): vector is number[] => vector !== null);
      if (complete.length !== texts.length) continue;
      const normalised = complete
        .map((vector) => truncateAndRenormalise(vector))
        .filter((vector): vector is number[] => vector !== null);
      if (normalised.length !== texts.length) continue;
      return normalised;
    } catch {
      // Network or timeout: fall through to the retry, then to null.
    }
  }
  return null;
}

/**
 * Embed texts in batches of up to 8. Returns null on any HTTP, timeout or
 * provider error (one retry with backoff first) and never throws. When the
 * feature switch is off, or no key is configured, no outbound call is made.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  if (process.env.WIKI_EMBEDDINGS !== "1") return null;
  const key = process.env[
    process.env.WIKI_EMBEDDINGS_API_KEY_ENV || "TENSORX_API_KEY"
  ];
  if (!key) return null;
  const results: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const embedded = await embedBatch(batch, key);
    if (!embedded) return null;
    results.push(...embedded);
  }
  return results;
}
