-- Same short-lived storage convention as tenants.initial_password: cleared on reveal.
CREATE TABLE member_bookstack_logins (
 team_id uuid NOT NULL,
 user_id uuid NOT NULL,
 bookstack_user_id integer CHECK (bookstack_user_id > 0),
 bookstack_role text NOT NULL DEFAULT 'Editor',
 initial_password text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 PRIMARY KEY (team_id,user_id),
 FOREIGN KEY (user_id,team_id) REFERENCES memberships(user_id,team_id) ON DELETE CASCADE
);
