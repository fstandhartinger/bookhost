CREATE TABLE IF NOT EXISTS tenants (
    id uuid primary key default gen_random_uuid(),
    team_id uuid null,
    slug text unique not null,
    status text not null default 'pending' check (status in ('pending','provisioning','running','failed','suspended')),
    bookstack_url text,
    admin_email text,
    initial_password text,
    error text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS desired_state text NOT NULL DEFAULT 'running'
    CHECK (desired_state IN ('running','suspended'));
