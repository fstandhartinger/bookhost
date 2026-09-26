-- Agent access (MCP) per workspace. Agents authenticate with a BookStack API
-- token of their own BookStack user, so BookStack permissions stay the only
-- authorization source. These tables hold settings, the dashboard-managed agent
-- identities and a metadata-only activity log (never page content or secrets).
CREATE TABLE IF NOT EXISTS agent_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 write_mode text NOT NULL DEFAULT 'propose' CHECK (write_mode IN ('off','propose','direct')),
 access_enabled boolean NOT NULL DEFAULT true,
 disabled_at timestamptz,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per dashboard-created agent. token_id is BookStack's public token
-- identifier (not a secret). pending_secret_enc is the AES-GCM encrypted secret,
-- kept only until the host worker has installed the token; it is then NULLed.
CREATE TABLE IF NOT EXISTS agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
 role_id integer NOT NULL CHECK (role_id > 0),
 role_name text NOT NULL,
 bookstack_user_id integer CHECK (bookstack_user_id > 0),
 token_id text NOT NULL UNIQUE CHECK (token_id ~ '^[A-Za-z0-9]{32}$'),
 pending_secret_enc text,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoke_requested','revoked','failed')),
 error text,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 CHECK (status NOT IN ('active','revoked','revoke_requested') OR pending_secret_enc IS NULL)
);
CREATE INDEX IF NOT EXISTS agents_tenant ON agents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agents_worker_queue ON agents(status) WHERE status IN ('pending','revoke_requested');

CREATE TABLE IF NOT EXISTS agent_activity (
 id bigserial PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
 token_fingerprint text NOT NULL CHECK (token_fingerprint ~ '^[a-f0-9]{12}$'),
 tool text NOT NULL CHECK (char_length(tool) <= 40),
 target text CHECK (char_length(target) <= 80),
 status text NOT NULL CHECK (status IN ('ok','proposed','denied','error','rate_limited')),
 latency_ms integer NOT NULL CHECK (latency_ms >= 0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_activity_recent ON agent_activity(tenant_id, created_at DESC);
