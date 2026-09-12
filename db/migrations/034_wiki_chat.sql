-- Per-workspace allowance for "Ask your wiki" questions, mirroring intake_quota.
CREATE TABLE IF NOT EXISTS chat_quota (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  period text NOT NULL,
  question_limit integer NOT NULL,
  used integer NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, period)
);
