-- Union of historical constraints (012/015/018) and application event writers.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_name_check;
ALTER TABLE events ADD CONSTRAINT events_name_check CHECK(name IN (
  'demo_click','checkout_start','trial_started','workspace_created',
  'intake_draft','intake_published','inbound_rejected',
  'bookstack_opened','onboarding_step_done'
));
