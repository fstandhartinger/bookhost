-- Operational history survives intake/analytics retention and analytics opt-out.
CREATE TABLE IF NOT EXISTS team_onboarding (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('password','workspace','bookstack','upload','publish','teammate','payment')),
  done_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id, step)
);

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
  SELECT 'onboarding_step_done',i.team_id,t.utm_source,i.step FROM inserted i JOIN teams t ON t.id=i.team_id
  WHERE emit_events AND NOT t.analytics_opt_out ON CONFLICT DO NOTHING;
$$;

-- Recover historical evidence before inspecting current state. No new analytics for backfill.
INSERT INTO team_onboarding(team_id,step,done_at)
SELECT team_id, step_name, min(ts) FROM events
WHERE name='onboarding_step_done' AND step_name IN ('password','workspace','bookstack','upload','publish','teammate','payment')
AND team_id IN (SELECT id FROM teams)
GROUP BY team_id,step_name ON CONFLICT DO NOTHING;
SELECT detect_team_onboarding(id,false) FROM teams;

-- Capture at the mutation, even if nobody visits the dashboard before retention runs.
CREATE OR REPLACE FUNCTION capture_team_onboarding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='users' THEN
    PERFORM detect_team_onboarding(id) FROM teams WHERE owner_user_id=NEW.id;
  ELSIF TG_TABLE_NAME='teams' THEN
    PERFORM detect_team_onboarding(NEW.id);
  ELSE
    PERFORM detect_team_onboarding(NEW.team_id);
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE tab text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['users','teams','tenants','intake_items','memberships','subscriptions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS capture_onboarding ON %I',tab);
    EXECUTE format('CREATE TRIGGER capture_onboarding AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION capture_team_onboarding()',tab);
  END LOOP;
END;
$$;
