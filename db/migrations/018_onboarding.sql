ALTER TABLE events DROP CONSTRAINT IF EXISTS events_name_check;
ALTER TABLE events ADD CONSTRAINT events_name_check CHECK(name IN ('demo_click','checkout_start','trial_started','workspace_created','intake_draft','intake_published','bookstack_opened','onboarding_step_done'));
ALTER TABLE events ADD COLUMN IF NOT EXISTS step_name text;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_step_once ON events(team_id,step_name) WHERE name='onboarding_step_done';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS bookstack_opened_at timestamptz;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
