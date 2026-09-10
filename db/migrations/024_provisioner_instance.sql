ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioner_instance text;

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
    CHECK (status IN ('pending','provisioning','running','failed','suspended','error'));
