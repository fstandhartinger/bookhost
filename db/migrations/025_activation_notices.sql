-- Preserve every existing billing kind and add the two activation notices.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (
  kind IN ('trial_ending_3d','trial_ending_1d','trial_ended','payment_failed',
           'activation_workspace','activation_first_page')
);
