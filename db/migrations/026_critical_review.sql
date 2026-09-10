-- Expand login lifecycle: retain mappings after membership removal for retries.
ALTER TABLE member_bookstack_logins ADD COLUMN managed_by_bookhost boolean;
ALTER TABLE member_bookstack_logins ADD COLUMN revocation_requested_at timestamptz;
ALTER TABLE member_bookstack_logins ADD COLUMN revoked_at timestamptz;
ALTER TABLE member_bookstack_logins ADD COLUMN revocation_error text;
-- Only unrevealed generated passwords prove legacy accounts were created by us.
UPDATE member_bookstack_logins SET managed_by_bookhost=true WHERE initial_password IS NOT NULL;
-- Keep the existing membership FK/cascade unchanged. Copy the mapping into a
-- durable outbox before deletion, without carrying the one-time password.
CREATE TABLE member_bookstack_revocations (
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 bookstack_user_id integer,
 managed_by_bookhost boolean,
 revocation_requested_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 revocation_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(team_id,user_id)
);

-- One durable reservation per team; committed before contacting Stripe.
CREATE TABLE team_checkout_reservations (
 team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
 period text NOT NULL,
 generation integer NOT NULL DEFAULT 1,
 idempotency_key text NOT NULL UNIQUE,
 params jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 session_id text,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- Independent browser requests can each complete the same reused session.
CREATE TABLE checkout_attempt_nonces (
 session_id text NOT NULL REFERENCES checkout_attempts(session_id) ON DELETE CASCADE,
 nonce_hash text NOT NULL,
 PRIMARY KEY(session_id,nonce_hash)
);
