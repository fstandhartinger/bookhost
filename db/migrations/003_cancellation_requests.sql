CREATE TABLE cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  note text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('cancel', 'withdrawal')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cancellation_requests_created_at_idx ON cancellation_requests(created_at);
