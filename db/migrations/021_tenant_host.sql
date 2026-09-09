ALTER TABLE tenants ADD COLUMN host text;
-- Preserve every existing workspace URL, regardless of rollout environment.
UPDATE tenants SET host = slug||'.wissen.app.mintapis.com' WHERE host IS NULL;
ALTER TABLE tenants ALTER COLUMN host SET NOT NULL;
ALTER TABLE tenants ADD CONSTRAINT tenants_host_key UNIQUE (host);
