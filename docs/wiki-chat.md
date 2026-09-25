# Ask your wiki

`POST /api/chat` answers questions from a workspace's own BookStack pages.
Retrieval is lexical by default: BookStack's full-text search, section
scoring, and an extractive answer assembled from quoted sentences with
citations. Nothing leaves BookHost in that mode.

## Hybrid (semantic) retrieval

For tenants whose semantic gate is open, the question is additionally embedded and
matched against a per-tenant chunk index (`wiki_chunks`, pgvector HNSW,
cosine). Semantic hits above a 0.30 similarity floor are cited first, then
lexical passages, deduplicated by page and section, capped at six. The JSON
response carries `retrieval: "lexical" | "hybrid"`; the chat UI shows a
subtle "semantic search" badge when hybrid.

The embedding provider is an OpenAI-compatible endpoint, TensorX by default
(EU processor details are handled by the supervisor). The provider emits
4096 dimensions and ignores the `dimensions` parameter, so vectors are
truncated to 1024 dimensions and L2 re-normalised before storage; the HNSW
index limit is 2000 dimensions.

Provider failures always degrade to the lexical path: the same cited
extractive answer, `retrieval: "lexical"`, and no 5xx caused by retrieval.

## Opt-in

Semantic retrieval is off by default. A workspace owner or admin turns it on
from the chat page (`GET`/`POST /api/chat/semantic`), which sets
`teams.wiki_semantic_opt_in_at` and starts the backfill in the background.
The gate (`semanticEnabled` in `lib/chat/embeddings.ts`) is true when the
global switch is on and the team is either on the operator allowlist or has
opted in; a database error fails closed. Turning it off nulls the column and
deletes the team's `wiki_chunks` rows immediately. The operator allowlist
wins: for an allowlisted team the API reports `source: "operator"` and
rejects customer toggles with 409.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WIKI_EMBEDDINGS` | unset | Feature switch. Must be exactly `1` for any tenant to use semantic retrieval. |
| `WIKI_EMBEDDINGS_TENANTS` | unset | Comma-separated team ids for the operator override (QA-tenant gate). Exact, trimmed match; no wildcard. |
| `WIKI_EMBEDDINGS_BASE_URL` | `https://api.tensorx.ai/v1` | OpenAI-compatible embeddings endpoint. |
| `WIKI_EMBEDDINGS_MODEL` | `qwen/qwen3-embedding-8b` | Embedding model name. |
| `WIKI_EMBEDDINGS_API_KEY_ENV` | `TENSORX_API_KEY` | Name of the environment variable holding the provider key. The key itself is only read at call time and never logged. |

When the gate is closed for a tenant, the embedder performs zero outbound
network calls and indexing is skipped.

## Indexing

- The chunk index is refreshed in-process hourly for every tenant whose gate
  is open (`instrumentation.ts`), alongside the other background jobs. The
  same run purges `wiki_chunks` rows of every team whose gate is now false,
  so no vectors outlive the opt-in.
- A chat request from a gated tenant whose index is missing or empty starts
  an asynchronous backfill (one run per tenant at a time) and answers
  lexically meanwhile.
- Only chunks whose content hash (SHA-256 of the chunk text) changed are
  re-embedded; rows for deleted pages are removed. A persistent embedding
  failure leaves the old rows in place and is reported, not raised.
