-- 021_email_login_flag.sql — one INSERT, exactly 016's shape (decision-64 §2).
--
-- decision-57's stated ceiling for an additional flag is "one INSERT, not a schema change",
-- and this is the third one. `email_login` is the SECOND, INDEPENDENT gate in front of the
-- email door: `emailConfigured()` (lib/email.js) says whether this box has a provider at
-- all, this says whether the door is OFFERED. GET /auth/capabilities and all four email
-- routes (routes/auth.js) gate on BOTH, so OFF hides the UI and also 503s a direct API call.
--
-- SEEDED DISABLED, per decision-57's "opt-in, defaults off everywhere" rule, and today that
-- is belt AND braces: no environment holds a RESEND_API_KEY either, so `capabilities().email`
-- reads false for both reasons. Turning the flag on alone changes nothing.
--
-- ON CONFLICT: re-running this file must never flip a live flag (016's own note).
--
-- NO BEGIN/COMMIT — migrate.js already runs each file with `psql -1`.
INSERT INTO feature_flags (name, enabled) VALUES ('email_login', false)
  ON CONFLICT (name) DO NOTHING;
