-- Keep click attempts separate from successfully created Stripe sessions.
-- These are subtypes of the existing disclosed checkout_start category; no
-- account IDs, URLs, free text or persistent visitor identifiers are added.
ALTER TABLE events ADD COLUMN IF NOT EXISTS checkout_stage text
  CHECK (checkout_stage IS NULL OR checkout_stage = 'click');
ALTER TABLE events ADD COLUMN IF NOT EXISTS cta_position text
  CHECK (cta_position IS NULL OR cta_position IN ('hero','nav','pricing_teaser','footer'));
