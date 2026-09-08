DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users GROUP BY lower(trim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate normalized user emails; reconcile accounts before migration';
  END IF;
END $$;
UPDATE users SET email=lower(trim(email)) WHERE email<>lower(trim(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users(lower(email));
CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
