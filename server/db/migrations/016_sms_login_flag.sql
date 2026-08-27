-- 016_sms_login_flag.sql — one INSERT, per decision-57's own stated ceiling for a second flag.
--
-- Requested during UAT prep (2026-08-27): SMS is fully wired (Twilio configured, working)
-- but the owner wants it hidden from the sign-in form for now, without editing
-- /etc/nfc/env. `GET /auth/capabilities` and all four SMS routes (routes/auth.js) now
-- gate on smsConfigured() AND this flag, so OFF hides the UI (both platforms already read
-- capabilities().sms before drawing the SMS section) and also 503s a direct API call —
-- the button cannot exist and the door cannot be knocked on even by hand.
--
-- Seeded DISABLED, matching the ask: "switch this flag off for now". Enrolment-code
-- sign-in (POST /auth/code, /auth/operator-code) is untouched by this flag entirely.
--
-- NO BEGIN/COMMIT — migrate.js already runs each file with `psql -1`.
INSERT INTO feature_flags (name, enabled) VALUES ('sms_login', false)
  ON CONFLICT (name) DO NOTHING;
