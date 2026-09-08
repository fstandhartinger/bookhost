ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version int NOT NULL DEFAULT 1;
UPDATE users SET email_verified_at=email_verified WHERE email_verified_at IS NULL AND email_verified IS NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS desired_state text NOT NULL DEFAULT 'running' CHECK (desired_state IN ('running','suspended'));
CREATE TABLE IF NOT EXISTS consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 team_id uuid NOT NULL REFERENCES teams(id),
 document text NOT NULL,
 version text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT now(),
 ip text,
 user_agent text,
 UNIQUE(user_id,team_id,document,version)
);
