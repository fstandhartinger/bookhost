ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_created_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS has_payment_method boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS subscriptions_team_status_trial ON subscriptions(team_id,status,trial_end);
CREATE INDEX IF NOT EXISTS subscriptions_trial_window ON subscriptions(trial_end,team_id);
CREATE OR REPLACE VIEW effective_subscriptions AS
SELECT DISTINCT ON (team_id) * FROM subscriptions
ORDER BY team_id, (status IN ('trialing','active','past_due')) DESC,
 COALESCE(stripe_created_at,created_at) DESC, stripe_subscription_id DESC;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mail_status text NOT NULL DEFAULT 'pending' CHECK (mail_status IN ('pending','sent','mail_failed'));
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subscription_id text;
CREATE INDEX IF NOT EXISTS notifications_pending ON notifications(created_at) WHERE resolved_at IS NULL AND mail_status<>'sent';
