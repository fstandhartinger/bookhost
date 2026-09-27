ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS is_showcase boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN teams.is_showcase IS
  'Operator-only internal test/showcase marker; excluded from customer lifecycle alerts, billing expiry, and funnel analytics.';

CREATE OR REPLACE FUNCTION analytics_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_name text;
BEGIN
 IF TG_TABLE_NAME='tenants' THEN event_name := 'workspace_created';
 ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('draft','published') THEN
   event_name := CASE NEW.status WHEN 'draft' THEN 'intake_draft' ELSE 'intake_published' END;
 END IF;
 IF event_name IS NOT NULL AND NEW.team_id IS NOT NULL THEN
   INSERT INTO events(name,team_id,utm_source)
   SELECT event_name,id,utm_source FROM teams
   WHERE id=NEW.team_id AND NOT analytics_opt_out AND NOT is_showcase;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION detect_team_onboarding(target uuid, emit_events boolean DEFAULT true)
RETURNS void LANGUAGE sql AS $$
  WITH facts AS (
    SELECT t.id, v.step, v.done_at FROM teams t JOIN users u ON u.id=t.owner_user_id
    CROSS JOIN LATERAL (VALUES
      ('password', u.password_set_at),
      ('workspace', (SELECT min(updated_at) FROM tenants WHERE team_id=t.id AND status='running')),
      ('bookstack', t.bookstack_opened_at),
      ('upload', (SELECT min(created_at) FROM intake_items WHERE team_id=t.id)),
      ('publish', (SELECT min(updated_at) FROM intake_items WHERE team_id=t.id AND status='published')),
      ('teammate', CASE WHEN (SELECT count(*) FROM memberships WHERE team_id=t.id)>1 THEN now() END),
      ('payment', (SELECT updated_at FROM effective_subscriptions WHERE team_id=t.id AND has_payment_method))
    ) AS v(step,done_at) WHERE t.id=target
  ), inserted AS (
    INSERT INTO team_onboarding(team_id,step,done_at)
    SELECT id,step,done_at FROM facts WHERE done_at IS NOT NULL
    ON CONFLICT DO NOTHING RETURNING *
  )
  INSERT INTO events(name,team_id,utm_source,step_name)
  SELECT 'onboarding_step_done',i.team_id,t.utm_source,i.step
  FROM inserted i JOIN teams t ON t.id=i.team_id
  WHERE emit_events AND NOT t.analytics_opt_out AND NOT t.is_showcase
  ON CONFLICT DO NOTHING;
$$;
