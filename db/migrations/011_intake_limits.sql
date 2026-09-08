ALTER TABLE intake_items ALTER COLUMN extracted_text DROP NOT NULL;
ALTER TABLE intake_items DROP CONSTRAINT intake_items_status_check;
ALTER TABLE intake_items ADD CHECK(status IN ('uploaded','queued','drafting','draft','approved','published','failed','rejected'));
ALTER TABLE intake_items ADD COLUMN target_book_name text, ADD COLUMN target_chapter_name text;
CREATE TABLE intake_quota (
 team_id uuid REFERENCES teams(id) ON DELETE CASCADE,
 period text NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK(used>=0),
 draft_limit integer NOT NULL CHECK(draft_limit>=0),
 PRIMARY KEY(team_id,period)
);
