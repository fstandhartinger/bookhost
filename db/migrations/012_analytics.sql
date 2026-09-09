ALTER TABLE teams ADD COLUMN IF NOT EXISTS utm_source text;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS analytics_opt_out boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS page_views (
 id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
 path text NOT NULL, referrer_host text, utm_source text, utm_medium text,
 utm_campaign text, visitor_hash text NOT NULL, country text
);
CREATE INDEX IF NOT EXISTS page_views_recent ON page_views(ts);
CREATE TABLE IF NOT EXISTS events (
 id bigserial PRIMARY KEY, ts timestamptz NOT NULL DEFAULT now(),
 name text NOT NULL CHECK(name IN ('demo_click','checkout_start','trial_started','workspace_created','intake_draft','intake_published')),
 team_id uuid REFERENCES teams(id) ON DELETE SET NULL, utm_source text, visitor_hash text
);
CREATE INDEX IF NOT EXISTS events_recent ON events(ts);
-- Transactional events follow successful writes, including background workers.
CREATE OR REPLACE FUNCTION analytics_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
 IF TG_TABLE_NAME='tenants' THEN event_name := 'workspace_created';
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('draft','published') THEN
   event_name := CASE NEW.status WHEN 'draft' THEN 'intake_draft' ELSE 'intake_published' END;
 END IF;
 IF event_name IS NOT NULL AND NEW.team_id IS NOT NULL THEN
   INSERT INTO events(name,team_id,utm_source)
   SELECT event_name,id,utm_source FROM teams WHERE id=NEW.team_id AND NOT analytics_opt_out;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_workspace ON tenants;
CREATE TRIGGER analytics_workspace AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION analytics_transition();
DROP TRIGGER IF EXISTS analytics_intake ON intake_items;
CREATE TRIGGER analytics_intake AFTER UPDATE OF status ON intake_items FOR EACH ROW EXECUTE FUNCTION analytics_transition();
