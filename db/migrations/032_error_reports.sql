-- Persist only the allow-listed, pseudonymized diagnostic context.
CREATE TABLE IF NOT EXISTS error_reports (
  id bigserial PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  phase text,
  correlation_id text NOT NULL,
  error_category text NOT NULL,
  team_id uuid,
  session_id text
);

CREATE INDEX IF NOT EXISTS error_reports_ts_idx ON error_reports (ts DESC);
