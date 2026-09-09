ALTER TABLE memberships ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS team_invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 role text NOT NULL CHECK (role IN ('admin','member')),
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
 max_uses integer NOT NULL CHECK (max_uses IN (1,10)),
 uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_invites_team ON team_invites(team_id);
