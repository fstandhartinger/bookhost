-- Store the reservation period, rather than guessing from failure time (UTC rollover).
-- Legacy items have no reliably recoverable reservation period and remain untouched.
ALTER TABLE intake_items ADD COLUMN quota_period text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_used_bytes bigint CHECK (storage_used_bytes >= 0);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_measured_at timestamptz;

-- Runs in the same transaction as the failure, including hourly crash recovery.
-- A produced draft still counts when rejected or when publication subsequently fails.
CREATE FUNCTION refund_failed_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.draft_html IS NULL AND OLD.quota_period IS NOT NULL THEN
    UPDATE intake_quota SET used = GREATEST(0, used - 1)
      WHERE team_id = OLD.team_id AND period = OLD.quota_period;
    NEW.quota_period := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER intake_refund_failed_draft BEFORE UPDATE ON intake_items
FOR EACH ROW EXECUTE FUNCTION refund_failed_draft();
