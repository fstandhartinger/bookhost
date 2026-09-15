-- Vector index for hybrid wiki chat retrieval. Vectors are truncated to 1024
-- dimensions and L2 re-normalised before storage (provider emits 4096, the HNSW
-- index caps at 2000); distance is cosine.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS wiki_chunks (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  page_id integer NOT NULL,
  page_name text NOT NULL,
  book_id integer,
  section text,
  url text,
  chunk_ordinal integer NOT NULL,
  chunk text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(1024),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, page_id, chunk_ordinal)
);

CREATE INDEX IF NOT EXISTS wiki_chunks_embedding_hnsw ON wiki_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS wiki_chunks_team ON wiki_chunks (team_id);
