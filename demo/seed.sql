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
  -- ...and on THIS machine. The name alone is not enough: psql honours a `host=` query
  -- parameter and $PGHOST, so `postgres:///nfc_demo?host=<live>` reaches a REMOTE server
  -- and every check above still passes if a database there is also called nfc_demo.
  -- inet_server_addr() is answered by the server, so it cannot be talked out of it:
  -- NULL means a unix socket (necessarily this machine), otherwise it must be loopback.
  IF inet_server_addr() IS NOT NULL AND NOT (inet_server_addr() <<= inet '127.0.0.0/8'
                                         OR inet_server_addr() = inet '::1') THEN
    RAISE EXCEPTION
      'demo/seed.sql refuses to run on REMOTE server %: it TRUNCATEs. Loopback only.',
      inet_server_addr();
  END IF;
END
$$;

TRUNCATE material_requests, location_contracts, portal_grants, shifts,
         locations, contacts, clients, inventory_items, worker_sessions,
         workers, app_settings,
         -- decision-45 (007). Named explicitly rather than left to CASCADE from `workers`:
         -- TRUNCATE workers CASCADE sweeps phone_identities (a child of workers) but NOT
         -- operators (phone_identities' OTHER parent) or operator_sessions (a child of
         -- operators) — without naming operators here, a second run of this file would
         -- accumulate duplicate operator rows forever instead of giving the same screen
         -- twice, exactly the bug this TRUNCATE-first design exists to prevent.
         operators, phone_identities, operator_sessions
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
-- Operators (decision-45, migration 007). Invented people, same as the workers above.
--
-- UNLIKE workers.phone, an operator's phone cannot be left NULL: identityPhone() has no
-- optional case (OPERATOR-MODEL.md §4), so this table cannot demonstrate a screen without
-- a real-looking value in every row. The same risk the workers comment above names (an
-- invented Austrian mobile number in a public repo is somebody's real number) is handled
-- here by making the numbers OBVIOUSLY synthetic — sequential trailing zeros no real
-- subscriber range would issue — rather than by omitting them.
--
-- Three rows, three states this screen has to render distinguishably without colour:
--   Karin Bauer       active, no linked worker              → "Auch Mitarbeiter": Nein
--   Nikola Petrovic    active, SAME PERSON as the worker      → "Auch Mitarbeiter": a link
--                       of the same name (decision-45 §3: one phone, one phone_identities
--                       row, two person-rows) — also the longest name in the seed, on
--                       purpose, to stress the 390px "Auch Mitarbeiter" cross-link cell
--                       against the actions column the way no other row here can.
--   Petra Illek       INACTIVE, no linked worker             → "Status": Inaktiv, in words
-- ---------------------------------------------------------------------------
INSERT INTO operators (name, active) VALUES
  ('Karin Bauer',      true),
  ('Nikola Petrovic',  true),
  ('Petra Illek',      false);

INSERT INTO phone_identities (phone_e164, operator_id) VALUES
  ('+436600000001', (SELECT id FROM operators WHERE name = 'Karin Bauer')),
  ('+436600000003', (SELECT id FROM operators WHERE name = 'Petra Illek'));

-- Nikola Petrovic: the SAME real person as the worker of that name (decision-45 §3) —
-- one phone_identities row, worker_id AND operator_id both set.
INSERT INTO phone_identities (phone_e164, worker_id, operator_id) VALUES
  ('+436600000002',
   (SELECT id FROM workers   WHERE name = 'Nikola Petrovic'),
   (SELECT id FROM operators WHERE name = 'Nikola Petrovic'));

-- A WORKER-ONLY claim: worker_id set, operator_id NULL. Invisible on /operators/ by
-- definition — it is here because it is the ONE registry shape that changes what a DELETE
-- does. ON DELETE SET NULL drives such a row to (NULL, NULL) mid-statement and
-- phone_identities_claims aborts, so `DELETE FROM workers` fails outright unless the row
-- is detached FIRST (ops/reset-w1.sql §4, demo/check-reach.mjs's EMPTIED order). Without a
-- row of this shape in the seed, both of those orderings are assertions nothing can
-- falsify: the order mutant on check-reach's list was green until this row existed.
-- No route in this tree creates one yet (POST /operator/workers is blocked on
-- OPERATOR-MODEL.md §8), which is exactly why the fixture has to be explicit.
INSERT INTO phone_identities (phone_e164, worker_id) VALUES
  ('+436600000004', (SELECT id FROM workers WHERE name = 'Marta Nowak'));

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
-- § A worker at TWO buildings, one of which she is the only person to clean.
--
-- WHAT THIS BLOCK USED TO BE. It seeded `hourly_rate_cents = 0` on purpose: the column
-- default, meaning "nobody has said what this person costs" and NOT "this person is free".
-- Eight surfaces refused to price those hours at 0,00 EUR and named the exclusion instead,
-- and this row was what made those checks able to fail.
--
-- decision-41 DELETED THE STATE. Migration 006 dropped the DEFAULT and added
-- `CHECK (hourly_rate_cents > 0)`, so a rate of 0 is unrepresentable and this INSERT would
-- refuse. The eight refusals went with it, so there is nothing left for the fixture to
-- prove and a zero here would only stop the seed from loading at all.
--
-- The SHIFTS stay, and so does the shape they were chosen for: one building she is the sole
-- cleaner of, one she shares with priced colleagues. That is still the realistic case for
-- everything else that reads per-building labour.
--
-- INSERTED AFTER § Contract prices ON PURPOSE, and this is now a REAL change to the demo
-- figures rather than a no-op: her hours used to carry seconds but no cost, and they now
-- carry both. The calibration above ran before this block, so every contract price stays
-- what it was and the two buildings simply look more expensive than they did — which is
-- the truth the old fixture was hiding.
--
-- Dates: three in the previous calendar month, which is what /payroll/ and /pl/ open on,
-- and two counted back from today, so the case is also inside the rolling 30-day window
-- the shift log opens on. 07:00-10:30 Vienna wall clock = 3.5 payable hours each.
-- ---------------------------------------------------------------------------
INSERT INTO workers (name, email, hourly_rate_cents, active) VALUES
  ('Ana Ilic', 'ana@example.test', 1350, true);

INSERT INTO shifts (worker_id, location_id, start_time, end_time, client_uuid)
SELECT (SELECT id FROM workers WHERE email = 'ana@example.test'),
       (SELECT id FROM locations WHERE slug = v.slug),
       v.starts_at,
       v.starts_at + interval '3 hours 30 minutes',
       gen_random_uuid()::text
FROM (
  SELECT slug, ((day + time '07:00') AT TIME ZONE 'Europe/Vienna') AS starts_at
  FROM (VALUES
    ('neubaugasse-25',
     (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date + 8),
    ('neubaugasse-25',
     (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date + 15),
    ('neubaugasse-25',
     (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date + 22),
    ('landstrasser-46',
     (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date + 10),
    ('landstrasser-46',
     (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date + 17),
    ('neubaugasse-25',  (now() AT TIME ZONE 'Europe/Vienna')::date - 4),
    ('landstrasser-46', (now() AT TIME ZONE 'Europe/Vienna')::date - 11)
  ) AS d(slug, day)
) AS v;

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

-- ---------------------------------------------------------------------------
-- § Zones, and the FOUR area states a screen has to tell apart (decision-43).
--
-- A zone is a place inside a building that gets cleaned and can carry a tag. IT IS NOT A
-- COSTING UNIT: a shift is building-level, so no duration is attributable to a zone, and
-- nothing here may ever grow a per-zone price.
--
--   donaufeld-101    three zones, ALL MEASURED   -> a real total, and EUR/m2 is answerable
--   handelskai-94    two zones, ONE UNMEASURED   -> the sum is a FLOOR, every per-m2 NULL
--   landstrasser-46  one zone, tag NOT MOUNTED   -> the resumable errand, mid-walk
--   gumpendorfer-63  one ADOPTED tag, by serial  -> hardware somebody else mounted, no URL
--   wagramer-4       ZERO ZONES, and it is ACTIVE
--   neubaugasse-25   ZERO ZONES, and it is ACTIVE
--
-- THE LAST TWO ARE THE POINT AND THEY ARE PRODUCTION'S SHAPE. HOIV has one building, zero
-- zones and a card already on its wall. If "no zones" is ever read as an operational state
-- rather than a presentational one, that card stops clocking anybody in and no site visit
-- can fix it. Two unzoned, active buildings here are what make that regression visible on
-- the map, in the buildings table and on /pl/ at the same time.
--
-- The serial is the REAL one from the Arsenalstrasse tag: an NXP Mifare Ultralight EV1 that
-- somebody else's system mounted, carrying no URL at all (46 bytes, our URI does not fit).
-- ---------------------------------------------------------------------------
INSERT INTO zones (location_id, name, note, area_sqm, tag_serial, tag_deployed_at)
SELECT (SELECT id FROM locations WHERE slug = v.slug),
       v.name, v.note, v.area_sqm, v.tag_serial,
       CASE WHEN v.deployed THEN now() - interval '30 days' ELSE NULL END
FROM (VALUES
  ('donaufeld-101',   'Stiege 1',      'Links neben der Gegensprechanlage', 240.00::numeric, NULL::text, true),
  ('donaufeld-101',   'Stiege 2',      'Neben dem Postkasten',              240.00,          NULL,       true),
  ('donaufeld-101',   'Tiefgarage',    'Saeule bei der Einfahrt',           610.50,          NULL,       true),
  -- Nobody has measured this one, and that is a SUPPORTED state: an invented m2 poisons
  -- every EUR/m2 figure computed from it, so the building reports a floor instead.
  ('handelskai-94',   'Buerogeschoss', 'Rechts der Lifttuer',               980.00,          NULL,       true),
  ('handelskai-94',   'Stiegenhaus B', 'Kein Plan vorhanden',               NULL,            NULL,       true),
  -- Mid-walk: the zone exists, the tag has not been put up. The list keeps offering
  -- "Tag-Einrichtung fortsetzen" until somebody is standing at the right door.
  ('landstrasser-46', 'Haupteingang',  'Noch anzubringen',                  310.00,          NULL,       false),
  -- Adopted hardware: matched by SERIAL through /roster, never by a URL it does not have.
  ('gumpendorfer-63', 'Ordination',    'Vorhandener Tag am Tuerstock',      95.00,           '04:A1:A8:52:AE:5C:80', true)
) AS v(slug, name, note, area_sqm, tag_serial, deployed);

-- A stood-down zone: history keeps naming the door a shift was tapped at, and its own tag
-- stops resolving. The list shows it and says which it is.
INSERT INTO zones (location_id, name, note, area_sqm, active)
SELECT (SELECT id FROM locations WHERE slug = 'donaufeld-101'),
       'Hof (Tag abgenommen)', 'Tag wurde bei der Fassadensanierung entfernt', 120.00, false;

-- Tap facts, so "zuletzt getippt" is not uniformly empty. `start_zone_id` is a TAP FACT and
-- never a cost split: the shift stays attached to the BUILDING (decision-43 section 4).
UPDATE shifts s
   SET start_zone_id = z.id, end_zone_id = z.id
  FROM zones z
 WHERE z.location_id = s.location_id
   AND z.name = 'Stiege 1'
   AND s.start_time > now() - interval '20 days';

-- ---------------------------------------------------------------------------
-- § Revenue: what the client ACTUALLY PAID, typed per building per month (decision-42).
--
-- FOUR STATES, and the screen must never collapse any two of them:
--   entered            a figure somebody typed
--   entered as 0       "they paid nothing this month" - a credit month, a dispute. REAL.
--   corrected          a figure that REPLACED an earlier one; the earlier one is kept
--   not entered        NO ROW AT ALL. Unknown, never 0, and never the contract value.
--
-- Two buildings are deliberately left with NO ROW for last month, so the P&L has to say
-- "nicht eingetragen" and report its own total as a partial sum.
-- ---------------------------------------------------------------------------
INSERT INTO location_revenue (location_id, month, amount_cents, note, entered_by, entered_at)
SELECT (SELECT id FROM locations WHERE slug = v.slug),
       (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - (v.months_back || ' months')::interval)::date,
       v.amount_cents, v.note,
       NULL,
       now() - interval '9 days'
FROM (VALUES
  ('donaufeld-101',   1, 185000, NULL),
  ('wagramer-4',      1,  96000, NULL),
  ('gumpendorfer-63', 1,  42000, NULL),
  -- A REAL ZERO. Not the unknown: this client paid nothing last month and said why.
  ('neubaugasse-25',  1,      0, 'Gutschrift wegen Wasserschaden, Reinigung ausgesetzt'),
  ('donaufeld-101',   2, 185000, NULL),
  ('wagramer-4',      2,  96000, NULL)
) AS v(slug, months_back, amount_cents, note);

-- A CORRECTION IS AN INSERT, NEVER AN UPDATE IN PLACE. The superseded row keeps its amount,
-- so the screen prints "geaendert 11.09. - vorher 1.250,00" instead of sending the director
-- to the database. Both rows are written explicitly here: the superseded one first, then
-- the one in force. The partial unique index admits exactly one live row per building-month
-- and would refuse the other order.
--
-- `entered_by` is NULLABLE and is NULL here on purpose: demo/make-admin.mjs runs AFTER this
-- seed, so there is no admin row to point at. The screen already has to render "eingetragen
-- 03.09." with no name, because an admin can be deleted, and this is that branch.
INSERT INTO location_revenue
  (location_id, month, amount_cents, note, entered_by, entered_at, superseded_at, superseded_by)
SELECT (SELECT id FROM locations WHERE slug = 'handelskai-94'),
       (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date,
       125000, 'Erste Ablesung', NULL,
       now() - interval '9 days', now() - interval '3 days', NULL;

INSERT INTO location_revenue (location_id, month, amount_cents, note, entered_by, entered_at)
SELECT (SELECT id FROM locations WHERE slug = 'handelskai-94'),
       (date_trunc('month', now() AT TIME ZONE 'Europe/Vienna') - interval '1 month')::date,
       138000, 'Nachtrag Sonderreinigung', NULL, now() - interval '3 days';

COMMIT;

-- ---------------------------------------------------------------------------
-- What was made. Printed so a recording session can see at a glance that the seed
-- landed, without opening the panel.
-- ---------------------------------------------------------------------------
SELECT 'workers'            AS what, count(*)::text AS n FROM workers
UNION ALL SELECT 'operators',           count(*)::text FROM operators
UNION ALL SELECT 'operators also worker', count(*)::text FROM phone_identities
                                        WHERE worker_id IS NOT NULL AND operator_id IS NOT NULL
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
-- Every wage is a real one now (decision-41). This must be 0 for ever: a row that got
-- past the CHECK would mean the constraint is gone.
UNION ALL SELECT 'workers without a rate', count(*)::text FROM workers
                                        WHERE hourly_rate_cents <= 0
-- The three area states, printed so a seed that lost one is obvious before a check has to
-- say so. All three must be > 0 (decision-43).
UNION ALL SELECT 'zones',               count(*)::text FROM zones
UNION ALL SELECT 'zones unmeasured',    count(*)::text FROM zones
                                        WHERE active AND area_sqm IS NULL
UNION ALL SELECT 'buildings unzoned',   count(*)::text FROM locations l
                                        WHERE NOT EXISTS (SELECT 1 FROM zones z
                                                           WHERE z.location_id = l.id AND z.active)
UNION ALL SELECT 'buildings fully measured', count(*)::text FROM locations l
                                        WHERE EXISTS (SELECT 1 FROM zones z
                                                       WHERE z.location_id = l.id AND z.active)
                                          AND NOT EXISTS (SELECT 1 FROM zones z
                                                           WHERE z.location_id = l.id AND z.active
                                                             AND z.area_sqm IS NULL)
-- Revenue: entered, corrected, a real 0, and months nobody has typed (decision-42).
UNION ALL SELECT 'revenue entries live',  count(*)::text FROM location_revenue
                                        WHERE superseded_at IS NULL
UNION ALL SELECT 'revenue corrections',   count(*)::text FROM location_revenue
                                        WHERE superseded_at IS NOT NULL
UNION ALL SELECT 'revenue entered as 0',  count(*)::text FROM location_revenue
                                        WHERE superseded_at IS NULL AND amount_cents = 0
UNION ALL SELECT 'app_settings',        count(*)::text FROM app_settings;
