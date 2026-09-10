-- Contract-Phase: erst anwenden, wenn KEIN altes Image mehr laeuft (>= 1 Deploy nach 021)
-- Explicit opt-in: npm run migrate -- --include-deferred
-- The migration runner wraps this in a transaction. Legacy INSERTs fail afterwards.
ALTER TABLE tenants ALTER COLUMN host SET NOT NULL;
DROP TRIGGER IF EXISTS tenant_host_legacy_default ON tenants;
DROP FUNCTION IF EXISTS tenant_host_legacy_default();
