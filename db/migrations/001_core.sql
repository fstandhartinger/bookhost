CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text,
 email_verified timestamptz, image text, checkout_session_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS teams (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, owner_user_id uuid NOT NULL REFERENCES users(id),
 stripe_customer_id text UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_owner_unique ON teams(owner_user_id);
CREATE TABLE IF NOT EXISTS memberships (user_id uuid REFERENCES users(id),team_id uuid REFERENCES teams(id),role text NOT NULL DEFAULT 'owner',PRIMARY KEY(user_id,team_id));
CREATE TABLE IF NOT EXISTS subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),team_id uuid NOT NULL REFERENCES teams(id),stripe_subscription_id text NOT NULL UNIQUE,
 status text NOT NULL,price_id text,trial_end timestamptz,current_period_end timestamptz,cancel_at_period_end boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,type text NOT NULL,provider text NOT NULL,provider_account_id text NOT NULL,
 refresh_token text,access_token text,expires_at bigint,token_type text,scope text,id_token text,session_state text,PRIMARY KEY(provider,provider_account_id)
);
CREATE TABLE IF NOT EXISTS verification_tokens (identifier text NOT NULL,token text NOT NULL,expires timestamptz NOT NULL,PRIMARY KEY(identifier,token));
CREATE TABLE IF NOT EXISTS sessions (session_token text PRIMARY KEY,user_id uuid REFERENCES users(id) ON DELETE CASCADE,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS checkout_logins (session_id text PRIMARY KEY,consumed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS checkout_attempts (session_id text PRIMARY KEY,nonce_hash text NOT NULL,user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS stripe_events (id text PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
