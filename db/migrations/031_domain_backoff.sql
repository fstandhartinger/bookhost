-- Additive: pace certificate retries so one misconfigured customer domain cannot
-- exhaust the shared ACME quota of this host.
ALTER TABLE tenant_domains ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
