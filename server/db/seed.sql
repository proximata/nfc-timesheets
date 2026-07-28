-- ###########################################################################
-- ## DEV ONLY. DO NOT RUN AGAINST PRODUCTION.                              ##
-- ## Fake workers, real Vienna addresses. Payroll numbers here are made up.##
-- ###########################################################################
--
-- This file is NOT a migration and lives outside migrations/ on purpose —
-- migrate.js will never pick it up. Run it by hand:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/seed.sql
--
-- Idempotent: re-running inserts nothing new.

BEGIN;

-- workers ------------------------------------------------------------------
-- hourly_rate_cents: EUR cents. 1450 = EUR 14.50/h.
-- Ballpark of the Austrian cleaning-trade collective agreement, not real contracts.
-- email is the Sign in with Apple pre-authorisation (decision-22) and must be LOWERCASE:
-- login lower-cases before it looks the address up, so a mixed-case row never matches.
-- These are @example.test addresses on purpose - no real Apple ID can claim them, so a dev
-- seed can never accidentally hand someone a session on a real box.
INSERT INTO workers (name, email, hourly_rate_cents)
SELECT v.name, v.email, v.rate
FROM (VALUES
  ('Anna Müller',   'anna@example.test',   1450),
  ('Ivan Horvat',   'ivan@example.test',   1380),
  ('Fatima Yılmaz', 'fatima@example.test', 1520)
) AS v(name, email, rate)
WHERE NOT EXISTS (SELECT 1 FROM workers w WHERE w.name = v.name);

-- locations ----------------------------------------------------------------
-- decision-21: the NFC tag URI carries the UUID id, NEVER the slug:
--   https://timesheets.exe.xyz/t?l=<id>
-- ids are left to gen_random_uuid() even here, so nothing in dev can grow a habit
-- of hardcoding a location id. Read them back with:
--   psql "$DATABASE_URL" -c 'select slug, id from locations order by slug'
-- slug stays human-readable (ASCII, lowercase) for the admin UI and log lines only.
INSERT INTO locations (slug, name, address, lat, lng) VALUES
  ('stephansplatz-4',
   'Bürohaus Stephansplatz',
   'Stephansplatz 4, 1010 Wien',
   48.20849, 16.37320),
  ('mariahilfer-88',
   'Wohnhaus Mariahilfer Straße',
   'Mariahilfer Straße 88, 1070 Wien',
   48.19783, 16.34608),
  ('praterstrasse-25',
   'Praxiszentrum Praterstraße',
   'Praterstraße 25, 1020 Wien',
   48.21519, 16.38466)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
