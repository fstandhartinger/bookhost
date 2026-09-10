ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS contract_ended_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_grace_started_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_grace_until timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS payment_failure_notified_at timestamptz;
CREATE INDEX IF NOT EXISTS subscriptions_retention_due ON subscriptions(contract_ended_at) WHERE contract_ended_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_payment_grace_due ON subscriptions(payment_grace_until) WHERE status IN ('past_due','unpaid');
CREATE OR REPLACE VIEW effective_subscriptions AS
SELECT DISTINCT ON (team_id) * FROM subscriptions
ORDER BY team_id, (status IN ('trialing','active','past_due','unpaid')) DESC,
 COALESCE(stripe_created_at,created_at) DESC, stripe_subscription_id DESC;
