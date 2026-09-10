-- A claim records an irreversible delivery attempt. Never expire/requeue it:
-- SMTP may already have accepted the message even if the process died.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS mail_claimed_at timestamptz;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_mail_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_mail_status_check
  CHECK (mail_status IN ('pending','claimed','sent','mail_failed'));
CREATE INDEX IF NOT EXISTS notifications_unclaimed_mail ON notifications(created_at,id)
  WHERE resolved_at IS NULL AND mail_status='pending' AND attempts=0 AND mail_claimed_at IS NULL;
