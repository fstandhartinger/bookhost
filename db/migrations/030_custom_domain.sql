-- Additive; withdrawal retains global ownership until the worker removes routing.
CREATE TABLE IF NOT EXISTS tenant_domains (
 team_id uuid NOT NULL REFERENCES teams(id),
 host text NOT NULL UNIQUE CHECK (host=lower(host)),
 status text NOT NULL DEFAULT 'pending_dns' CHECK (status IN ('pending_dns','verified','active','failed')),
 verification_token text NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz,
 active_at timestamptz,
 last_error text,
 removal_requested_at timestamptz,
 last_attempt_at timestamptz,
 PRIMARY KEY(team_id,host)
);
-- Serialize even non-API insertions against the same team lock.
CREATE OR REPLACE FUNCTION enforce_tenant_domain_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM teams WHERE id=NEW.team_id FOR UPDATE;
 IF (SELECT count(*) FROM tenant_domains WHERE team_id=NEW.team_id) >= 3 THEN
  RAISE EXCEPTION 'At most three custom domains per team' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_domain_limit ON tenant_domains;
CREATE TRIGGER tenant_domain_limit BEFORE INSERT ON tenant_domains FOR EACH ROW EXECUTE FUNCTION enforce_tenant_domain_limit();
