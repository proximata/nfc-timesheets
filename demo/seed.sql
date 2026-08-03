-- ###########################################################################
-- ## DEMO DATA. LOCAL ONLY. NEVER RUN THIS AGAINST PRODUCTION.             ##
-- ##                                                                       ##
-- ## Every person, company, email and contract figure below is INVENTED.   ##
-- ## Nothing here comes from the live system: not a name, not an address,  ##
-- ## not a rate, not a shift. The Vienna street addresses are real streets  ##
-- ## (so geocoding has something to chew on) attached to fictional          ##
-- ## buildings and fictional clients.                                       ##
-- ###########################################################################
--
-- Run it (see backlog/docs/DEMO.md):
--   createdb nfc_demo
--   DATABASE_URL=postgres:///nfc_demo node server/db/migrate.js
--   psql -d nfc_demo -v ON_ERROR_STOP=1 -f demo/seed.sql
--
-- NOT idempotent by accident — it TRUNCATEs first, on purpose, so re-running gives the
-- same screens rather than three months of stacked shifts. That is exactly why the guard
-- below exists.
--
-- Dates are relative to now(), so the screens always show "this month" and a recording
-- made today and one made in March look alike.

BEGIN;

-- ---------------------------------------------------------------------------
-- GUARD. This file truncates payroll tables. A demo seed pointed at the live
-- database by a tired copy-paste is the one accident that cannot be undone, so it
-- refuses to run anywhere whose database name is not literally a demo name.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF current_database() <> 'nfc_demo' THEN
    RAISE EXCEPTION
      'demo/seed.sql refuses to run on database "%": it TRUNCATEs. Expected nfc_demo.',
      current_database();
  END IF;
END
$$;

TRUNCATE material_requests, location_contracts, portal_grants, shifts,
         locations, contacts, clients, inventory_items, worker_sessions,
         workers, app_settings
  RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- Workers. Invented people. @example.test can never be claimed by a real Apple ID,
-- so a demo row can never hand anybody a session on a real box.
-- hourly_rate_cents is EUR cents; the spread is a plausible cleaning-trade range.
-- Phones are left NULL rather than made up: a made-up Austrian mobile number in a
-- public repo is somebody's real number.
-- ---------------------------------------------------------------------------
INSERT INTO workers (name, email, hourly_rate_cents, active) VALUES
  ('Marta Nowak',      'marta@example.test',   1480, true),
  ('Selim Kaya',       'selim@example.test',   1420, true),
  ('Andrea Steiner',   'andrea@example.test',  1550, true),
  ('Nikola Petrovic',  'nikola@example.test',  1390, true),
  ('Elif Demir',       'elif@example.test',    1450, true),
  ('Tomasz Wojcik',    'tomasz@example.test',  1400, false);

-- ---------------------------------------------------------------------------
-- Clients and their contact people. Invented companies.
-- contacts.email is NOT a credential (there is no contact login) — the client portal
-- is a shareable link. It is here because the director needs somebody to phone.
-- ---------------------------------------------------------------------------
INSERT INTO clients (name, active) VALUES
  ('Hausverwaltung Donaublick GmbH', true),
  ('Ordinationszentrum Guertel OG',  true),
  ('Buerozentrum Handelskai GmbH',   true);

INSERT INTO contacts (client_id, name, email, active) VALUES
  (1, 'Petra Aigner',   'petra.aigner@example.test',   true),
  (1, 'Josef Brandner', 'josef.brandner@example.test', true),
  (2, 'Lena Hofbauer',  'lena.hofbauer@example.test',  true),
  (3, 'David Kraus',    'david.kraus@example.test',    true);

-- ---------------------------------------------------------------------------
-- Buildings. Real Vienna streets, invented buildings, invented prices.
-- lat/lng are filled in here so the map and the analytics screen have something to
-- draw without calling Google during a recording. geocode_status 'OK' is therefore
-- true of these rows: they have a real pin.
--
-- Neubaugasse is deliberately left with NO contract and NO pin. It is the row that
-- proves the P&L says "Kein Vertrag hinterlegt" instead of inventing a zero, and that
-- a building with no coordinates still appears in the table under the map.
--
-- Prices are NOT set here. They are derived from the hours actually worked, further
-- down, once the shifts exist — see § Contract prices.
-- ---------------------------------------------------------------------------
INSERT INTO locations
  (slug, name, address, lat, lng, client_id, contact_id,
   geocoded_at, geocode_status, street_view_status, active)
VALUES
  ('donaufeld-101', 'Wohnhausanlage Donaufeld',
   'Donaufelder Strasse 101, 1210 Wien', 48.25361, 16.42194,
   1, 1, now() - interval '20 days', 'OK', NULL, true),

  ('wagramer-4', 'Wohnhaus Wagramer Strasse',
   'Wagramer Strasse 4, 1220 Wien', 48.23472, 16.42250,
   1, 2, now() - interval '20 days', 'OK', NULL, true),

  ('gumpendorfer-63', 'Ordination Gumpendorf',
   'Gumpendorfer Strasse 63, 1060 Wien', 48.19472, 16.34694,
   2, 3, now() - interval '20 days', 'OK', NULL, true),

  ('landstrasser-46', 'Aerztezentrum Landstrasse',
   'Landstrasser Hauptstrasse 46, 1030 Wien', 48.20250, 16.39472,
   2, 3, now() - interval '20 days', 'OK', NULL, true),

  ('handelskai-94', 'Buerozentrum Handelskai',
   'Handelskai 94, 1200 Wien', 48.24222, 16.38472,
   3, 4, now() - interval '20 days', 'OK', NULL, true),

  ('neubaugasse-25', 'Studiohaus Neubaugasse',
   'Neubaugasse 25, 1070 Wien', NULL, NULL,
   NULL, NULL, NULL, NULL, NULL, true);

-- ---------------------------------------------------------------------------
-- Inventory: products and equipment in one table, separated by kind.
-- ---------------------------------------------------------------------------
INSERT INTO inventory_items (name, kind, unit_cost_cents, active) VALUES
  ('Allzweckreiniger 5 l',        'product',    1290, true),
  ('Sanitaerreiniger 1 l',        'product',     640, true),
  ('Glasreiniger 1 l',            'product',     480, true),
  ('Muellsaecke 120 l (25 Stk)',  'product',     890, true),
  ('Mikrofasertuecher (10 Stk)',  'product',    1150, true),
  ('Wischmop Ersatzbezug',        'product',     760, true),
  ('Reinigungswagen',             'equipment', 24900, true),
  ('Staubsauger 1200 W',          'equipment', 17900, true),
  ('Teleskop-Fensterwischer',     'equipment',  4900, true);

-- ---------------------------------------------------------------------------
-- Shifts: the last 120 Vienna days (four months).
--
-- A month was asked for; four are generated. The month-by-month trend on the analytics
-- screen and the period-correct contract change both need more than one month behind
-- them, and a screen whose history column is empty demonstrates nothing.
--
-- Deterministic, not random: the same seed run twice produces the same screens, so a
-- re-recorded clip matches the one it replaces. The "randomness" is arithmetic on the
-- day-of-year and the worker's row number.
--
-- start_time is built from a Vienna WALL CLOCK time and converted, so shifts sit at
-- believable hours on both sides of the October/March clock change instead of drifting
-- an hour.
-- ---------------------------------------------------------------------------
WITH w AS (
  SELECT id, row_number() OVER (ORDER BY id) - 1 AS rn
  FROM workers WHERE active
),
l AS (
  SELECT id, row_number() OVER (ORDER BY slug) - 1 AS rn, count(*) OVER () AS n
  FROM locations WHERE slug <> 'neubaugasse-25'
),
d AS (
  SELECT generate_series(
           (now() AT TIME ZONE 'Europe/Vienna')::date - 120,
           (now() AT TIME ZONE 'Europe/Vienna')::date - 1,
           interval '1 day')::date AS day
),
plan AS (
  SELECT d.day,
         w.id  AS worker_id,
         w.rn  AS wrn,
         (SELECT id FROM l WHERE l.rn = (extract(doy FROM d.day)::int * 3 + w.rn * 2) % l.n)
           AS location_id,
         -- 06:00 / 14:00 / 17:00 starts, so the shift list is not one grey block
         (ARRAY['06:00', '14:00', '17:00'])[1 + (extract(doy FROM d.day)::int + w.rn) % 3]
           AS start_local,
         -- 105 .. 225 minutes
         (105 + ((extract(doy FROM d.day)::int * 7 + w.rn * 31) % 5) * 30)::int AS minutes
  FROM d CROSS JOIN w
  -- Nobody cleans every building every day. Sundays off, plus a rotation gap.
  WHERE extract(isodow FROM d.day) <> 7
    AND (extract(doy FROM d.day)::int + w.rn * 2) % 3 <> 0
)
INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid)
SELECT plan.worker_id,
       plan.location_id,
       ((plan.day + plan.start_local::time) AT TIME ZONE 'Europe/Vienna'),
       ((plan.day + plan.start_local::time) AT TIME ZONE 'Europe/Vienna')
         + make_interval(mins => plan.minutes),
       gen_random_uuid()::text
FROM plan;

-- One shift typed into the admin panel because a phone died: client_uuid IS NULL is the
-- only mark it carries, and that is deliberate (see server/db/README.md).
UPDATE shifts SET client_uuid = NULL
WHERE id = (SELECT id FROM shifts ORDER BY start_time DESC OFFSET 4 LIMIT 1);

-- An auto-closed shift a human has already resolved: both flags set, so it counts.
UPDATE shifts
SET auto_closed = true,
    corrected_at = start_time + interval '9 hours',
    end_time = start_time + interval '3 hours 40 minutes'
WHERE id = (SELECT id FROM shifts ORDER BY start_time DESC OFFSET 11 LIMIT 1);

-- An auto-closed shift NOBODY has resolved: the 8h safety net fired and no human has
-- confirmed the real end time. decision-10 — these hours are NOT payable and must not
-- reach payroll or the P&L. The screens report them separately instead of hiding them.
UPDATE shifts
SET auto_closed = true,
    corrected_at = NULL,
    end_time = start_time + interval '8 hours'
WHERE id IN (SELECT id FROM shifts ORDER BY start_time DESC OFFSET 2 LIMIT 2);

-- One shift running right now, so the dashboard has an open shift to show.
INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid)
SELECT (SELECT id FROM workers WHERE email = 'elif@example.test'),
       (SELECT id FROM locations WHERE slug = 'gumpendorfer-63'),
       now() - interval '47 minutes',
       NULL,
       gen_random_uuid()::text
WHERE NOT EXISTS (
  SELECT 1 FROM shifts s
  WHERE s.end_time IS NULL
    AND s.worker_id = (SELECT id FROM workers WHERE email = 'elif@example.test')
);

-- ---------------------------------------------------------------------------
-- § Contract prices — DERIVED from the hours actually worked, not typed in.
--
-- Typed-in prices produced a demo where every building ran at a 40-70% margin, which
-- nobody in this trade would believe for a second and which would have made the P&L
-- screen look like it was inventing numbers. So each building is priced off its own
-- payable labour at a chosen margin, and the margins are chosen to be a real spread:
-- two comfortable, one thin, one marginal, and one that LOSES MONEY. The loss-making
-- one is the whole reason the screen exists.
--
-- Payable labour is exactly decision-10: an auto-closed shift nobody has resolved is
-- not payable, so it is not in the price basis either.
-- ---------------------------------------------------------------------------
WITH margins(slug, margin, target_factor) AS (VALUES
  ('donaufeld-101',   0.19, 0.95),   -- comfortable, and beating its target hours
  ('landstrasser-46', 0.15, 0.90),
  ('wagramer-4',      0.09, 1.10),   -- thin
  ('gumpendorfer-63', 0.03, 1.00),   -- marginal
  ('handelskai-94',  -0.06, 1.05)    -- LOSING MONEY at the current price
),
worked AS (
  -- The PREVIOUS CALENDAR MONTH, Vienna, because that is what /pl/ and /analytics/ open
  -- on (`useState<Period>('lastMonth')`). Calibrating against all four months would put a
  -- different set of margins on screen than the ones chosen above. It is also the only
  -- window that does not move under the recording: it is a closed month.
  SELECT s.location_id,
         SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time))) AS seconds,
         SUM(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0
             * w.hourly_rate_cents) AS labour_cents
  FROM shifts s
  JOIN workers w ON w.id = s.worker_id
  WHERE s.end_time IS NOT NULL
    AND NOT (s.auto_closed AND s.corrected_at IS NULL)
    AND s.start_time >= (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna')
                          - interval '1 month') AT TIME ZONE 'Europe/Vienna'
    AND s.start_time <  date_trunc('month', now() AT TIME ZONE 'Europe/Vienna')
                          AT TIME ZONE 'Europe/Vienna'
  GROUP BY s.location_id
)
UPDATE locations l
-- The basis is one whole month, so there is no prorating factor. 1.03 leaves room for
-- the material share, so the margin that lands on screen is the margin asked for here
-- rather than three points under it.
-- Rounded to whole tens of euro and quarter hours, because a contract is NEGOTIATED and
-- nobody signs "850,11 EUR". Rounding moves each margin by well under a point.
SET monthly_contract_cents =
      (round(worked.labour_cents * 1.03 / (1 - margins.margin) / 1000.0) * 1000)::int,
    target_minutes_per_month =
      (round(worked.seconds / 60.0 * margins.target_factor / 15.0) * 15)::int
FROM worked, margins
WHERE worked.location_id = l.id
  AND margins.slug = l.slug;

-- Contract history (005). locations.monthly_contract_cents is a MIRROR of the current
-- contract row and server/check-api.js asserts the two never disagree, so the rows below
-- are written FROM the locations table rather than typed a second time.
--
-- Handelskai gets a real price change 45 days ago: the old period is CLOSED with an end
-- date, not deleted. That is the whole point of the screen -- a report printed before the
-- change still adds up to what it said then.
INSERT INTO location_contracts
  (location_id, client_id, monthly_contract_cents, target_minutes_per_month,
   valid_from, valid_to, note)
SELECT l.id, l.client_id,
       round(l.monthly_contract_cents * 0.92)::int, l.target_minutes_per_month,
       (now() AT TIME ZONE 'Europe/Vienna')::date - 400,
       (now() AT TIME ZONE 'Europe/Vienna')::date - 45,
       'Erstvertrag'
FROM locations l WHERE l.slug = 'handelskai-94';

INSERT INTO location_contracts
  (location_id, client_id, monthly_contract_cents, target_minutes_per_month,
   valid_from, valid_to, note)
SELECT l.id, l.client_id, l.monthly_contract_cents, l.target_minutes_per_month,
       CASE WHEN l.slug = 'handelskai-94'
            THEN (now() AT TIME ZONE 'Europe/Vienna')::date - 45
            ELSE (now() AT TIME ZONE 'Europe/Vienna')::date - 400 END,
       NULL,
       CASE WHEN l.slug = 'handelskai-94'
            THEN 'Indexanpassung, zusaetzliches Stiegenhaus'
            ELSE 'Erstvertrag' END
FROM locations l
WHERE l.monthly_contract_cents IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Material requests: the queue in every state it can be in, in the worker's own words.
--
-- location_id is CONTEXT — the building the worker was standing in — and never a cost
-- attribution (decision-6 splits material cost pro-rata by labour hours).
-- One request is left UNPRICED on purpose: cost_cents NULL means "nobody typed the
-- invoice", which is not "free", and the P&L reports it separately.
-- ---------------------------------------------------------------------------
INSERT INTO material_requests
  (worker_id, location_id, body, status, admin_note, inventory_item_id,
   quantity, cost_cents, decided_at, ordered_at, arrived_at, seen_at, created_at)
SELECT * FROM (VALUES
  ((SELECT id FROM workers WHERE email = 'marta@example.test'),
   (SELECT id FROM locations WHERE slug = 'donaufeld-101'),
   'Brauche zwei neue Mopps, die alten faerben ab.',
   'arrived', 'Liegt im Lager, Regal 3.',
   (SELECT id FROM inventory_items WHERE name = 'Wischmop Ersatzbezug'),
   2, 1520,
   now() - interval '12 days', now() - interval '11 days',
   now() - interval '6 days', now() - interval '5 days',
   now() - interval '13 days'),

  ((SELECT id FROM workers WHERE email = 'selim@example.test'),
   (SELECT id FROM locations WHERE slug = 'handelskai-94'),
   'Der blaue Reiniger, der grosse Kanister. Ist leer.',
   'ordered', 'Bestellt beim Grosshaendler, Lieferung Donnerstag.',
   (SELECT id FROM inventory_items WHERE name = 'Allzweckreiniger 5 l'),
   4, 5160,
   now() - interval '4 days', now() - interval '3 days',
   NULL, NULL,
   now() - interval '5 days'),

  ((SELECT id FROM workers WHERE email = 'andrea@example.test'),
   (SELECT id FROM locations WHERE slug = 'landstrasser-46'),
   'Muellsaecke gehen aus, die grossen schwarzen.',
   'ordered', NULL,
   (SELECT id FROM inventory_items WHERE name = 'Muellsaecke 120 l (25 Stk)'),
   6, NULL,
   now() - interval '3 days', now() - interval '2 days',
   NULL, NULL,
   now() - interval '4 days'),

  ((SELECT id FROM workers WHERE email = 'nikola@example.test'),
   (SELECT id FROM locations WHERE slug = 'wagramer-4'),
   'Fensterwischer mit langer Stange waere gut fuer das Stiegenhaus.',
   'approved', 'Passt, einer fuer die Anlage.',
   (SELECT id FROM inventory_items WHERE name = 'Teleskop-Fensterwischer'),
   1, NULL,
   now() - interval '2 days', NULL, NULL, NULL,
   now() - interval '2 days'),

  ((SELECT id FROM workers WHERE email = 'elif@example.test'),
   (SELECT id FROM locations WHERE slug = 'gumpendorfer-63'),
   'Sanitaerreiniger fuer die Ordination, zwei Flaschen.',
   'submitted', NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   now() - interval '19 hours'),

  ((SELECT id FROM workers WHERE email = 'marta@example.test'),
   (SELECT id FROM locations WHERE slug = 'donaufeld-101'),
   'Neuer Staubsauger, der alte zieht kaum noch.',
   'submitted', NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   now() - interval '5 hours'),

  ((SELECT id FROM workers WHERE email = 'selim@example.test'),
   NULL,
   'Zweiter Reinigungswagen fuers Auto.',
   'rejected', 'Heuer nicht mehr im Budget. Bitte im Jaenner nochmal fragen.',
   NULL, NULL, NULL,
   now() - interval '8 days', NULL, NULL, NULL,
   now() - interval '9 days'),

  ((SELECT id FROM workers WHERE email = 'andrea@example.test'),
   (SELECT id FROM locations WHERE slug = 'handelskai-94'),
   'Mikrofasertuecher, die alten sind durch.',
   'arrived', NULL,
   (SELECT id FROM inventory_items WHERE name = 'Mikrofasertuecher (10 Stk)'),
   3, 3450,
   now() - interval '17 days', now() - interval '16 days',
   now() - interval '10 days', NULL,
   now() - interval '18 days')
) AS v;

COMMIT;

-- ---------------------------------------------------------------------------
-- What was made. Printed so a recording session can see at a glance that the seed
-- landed, without opening the panel.
-- ---------------------------------------------------------------------------
SELECT 'workers'            AS what, count(*)::text AS n FROM workers
UNION ALL SELECT 'locations',           count(*)::text FROM locations
UNION ALL SELECT 'clients',             count(*)::text FROM clients
UNION ALL SELECT 'contacts',            count(*)::text FROM contacts
UNION ALL SELECT 'inventory_items',     count(*)::text FROM inventory_items
UNION ALL SELECT 'contracts',           count(*)::text FROM location_contracts
UNION ALL SELECT 'material_requests',   count(*)::text FROM material_requests
UNION ALL SELECT 'shifts',              count(*)::text FROM shifts
UNION ALL SELECT 'shifts open',         count(*)::text FROM shifts WHERE end_time IS NULL
UNION ALL SELECT 'shifts unresolved',   count(*)::text FROM shifts
                                        WHERE auto_closed AND corrected_at IS NULL
UNION ALL SELECT 'app_settings',        count(*)::text FROM app_settings;
