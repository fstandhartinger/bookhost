CREATE TABLE IF NOT EXISTS intake_senders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 pattern text NOT NULL, added_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(team_id,pattern)
);
ALTER TABLE intake_items ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';
ALTER TABLE intake_items ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS intake_messages (
 message_id text PRIMARY KEY, team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 item_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intake_email_files (
 item_id uuid PRIMARY KEY REFERENCES intake_items(id) ON DELETE CASCADE,
 content bytea NOT NULL
);
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_name_check;
ALTER TABLE events ADD CONSTRAINT events_name_check CHECK(name IN ('demo_click','checkout_start','trial_started','workspace_created','intake_draft','intake_published','inbound_rejected'));
