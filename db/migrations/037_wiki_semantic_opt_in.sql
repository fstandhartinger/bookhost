-- Opt-in for matching by meaning (semantic wiki search). NULL means off;
-- a timestamp marks when the workspace owner or admin turned it on. The
-- vectors and chunk text for opted-in teams live in wiki_chunks (035).
ALTER TABLE teams ADD COLUMN IF NOT EXISTS wiki_semantic_opt_in_at timestamptz;
