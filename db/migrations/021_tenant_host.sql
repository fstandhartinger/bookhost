-- Expand phase: old images must remain able to INSERT without host.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS host text;
-- Preserve every existing workspace URL, regardless of rollout environment.
UPDATE tenants SET host = slug||'.wissen.app.mintapis.com' WHERE host IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_host_key ON tenants(host) WHERE host IS NOT NULL;

CREATE OR REPLACE FUNCTION tenant_host_legacy_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.host IS NULL THEN
    NEW.host := NEW.slug||'.wissen.app.mintapis.com';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_host_legacy_default ON tenants;
CREATE TRIGGER tenant_host_legacy_default BEFORE INSERT OR UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION tenant_host_legacy_default();
