-- A cancellation arrives, we issue a receipt promising action within two working
-- days, and the row lands in a table nothing has ever read. Without a way to mark
-- a request done, a watchdog could only ever shout or stay silent forever.
ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS handled_at timestamptz;
ALTER TABLE cancellation_requests ADD COLUMN IF NOT EXISTS handled_note text;
CREATE INDEX IF NOT EXISTS cancellation_requests_open_idx
  ON cancellation_requests(created_at) WHERE handled_at IS NULL;
