CREATE TABLE IF NOT EXISTS notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('trial_ending_3d','trial_ending_1d','trial_ended','payment_failed')),
 period text NOT NULL,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 UNIQUE(user_id,kind,period)
);
CREATE INDEX IF NOT EXISTS notifications_user_created ON notifications(user_id,created_at DESC);
