-- Live Edit (beta): real-time collaborative editing of BookStack pages via a
-- self-hosted Yjs/Hocuspocus overlay. Off by default, enabled per workspace by
-- an owner/admin. Enabling installs a small BookStack theme route (Logical
-- Theme System) that issues a signed, short-lived ticket for the exact
-- signed-in BookStack user using BookStack's own real permission checks — so
-- BookStack stays the only authorization source, matching agent_settings'
-- design. rollout_status tracks the host worker step that installs the theme
-- and restarts the tenant container; the control plane only advertises the
-- feature (injects the embed script, accepts join requests) once it reaches
-- 'ready', so a workspace is never told the feature is on before the
-- tenant-side route actually exists.
CREATE TABLE IF NOT EXISTS live_edit_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 rollout_status text NOT NULL DEFAULT 'none' CHECK (rollout_status IN ('none','pending','ready','failed')),
 hmac_secret_enc text,
 rollout_error text,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_edit_settings_worker_queue ON live_edit_settings(rollout_status) WHERE rollout_status = 'pending';

-- Metadata-only audit trail (never page content), mirroring agent_activity.
CREATE TABLE IF NOT EXISTS live_edit_sessions (
 id bigserial PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 page_id integer NOT NULL CHECK (page_id > 0),
 bookstack_user_id integer NOT NULL CHECK (bookstack_user_id > 0),
 can_edit boolean NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT now(),
 left_at timestamptz,
 saved_revision boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS live_edit_sessions_recent ON live_edit_sessions(tenant_id, joined_at DESC);
