CREATE TABLE tenant_secrets (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
 api_id text NOT NULL, api_secret_enc text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE intake_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 filename text NOT NULL, mime text NOT NULL, extracted_text text NOT NULL,
 status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','drafting','draft','approved','published','failed','rejected')),
 draft_title text, draft_html text, draft_tags jsonb NOT NULL DEFAULT '[]',
 target_book_id integer NOT NULL CHECK(target_book_id>0), target_chapter_id integer CHECK(target_chapter_id>0),
 bookstack_page_id integer, error text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intake_team_recent ON intake_items(team_id,created_at DESC);
