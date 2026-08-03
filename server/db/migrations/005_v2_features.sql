-- 005_v2_features.sql — material requests, contract history, settings, geocoding state.
--
-- The four deferred features (FUTURE_NAV in web/lib/nav.ts) land here in ONE file:
--   materialRequests     -> material_requests
--   plDashboard          -> app_settings (the baseline) + reads everything else
--   contractManagement   -> location_contracts
--   buildingAnalytics    -> locations.geocoded_at / street_view_status (+ reads contracts)
--
-- ADDITIVE ONLY. 001-004 are APPLIED ON THE LIVE BOX with 1 worker, 1 location, 1 client
-- and 5 real shifts in it, and are not editable (db/README.md). Every column added here is
-- NULLable or DEFAULTed. NO BEGIN/COMMIT — migrate.js runs each file with `psql -1`.
--
-- MONEY IS INTEGER CENTS. TIME IS INTEGER MINUTES OR SECONDS. No float anywhere: a P&L is
-- a subtraction, not a rounding argument.
--
-- WHAT IS DELIBERATELY *NOT* STORED HERE, because it can be derived and a stored copy
-- would drift (the lesson of decision-10's `needs_correction`):
--   * "is this request open?"        -> status IN ('submitted','approved','ordered')
--   * "was this building geocoded?"  -> lat IS NOT NULL
--   * "did geocoding fail?"          -> geocoded_at IS NOT NULL AND lat IS NULL
--   * per-building material COST     -> computed pro-rata from labour hours at read time
--                                       (decision-6). See the material_requests block.
--   * labour cost, revenue, margin   -> all computed in SQL at read time from shifts,
--                                       workers.hourly_rate_cents and location_contracts.

-- ---------------------------------------------------------------------------
-- material_requests — the worker asks for something, in their own words.
--
-- FREE TEXT IS THE INPUT AND IT STAYS FREE TEXT until a human maps it. There is no fuzzy
-- match against inventory_items, no auto-approval and no automatic status advance: a
-- worker writing "der blaue Reiniger, der große" is not a foreign key, and guessing which
-- one they meant would put a wrong number into a P&L with nobody able to see why.
--
-- LIFECYCLE (enforced in routes/admin.js as an explicit transition table, never as a free
-- `status` assignment from a client):
--   submitted -> approved | rejected
--   approved  -> ordered  | rejected
--   ordered   -> arrived
--   arrived, rejected are terminal
--
-- inventory_item_id / quantity / cost_cents are set BY THE ADMIN, never inferred. A row
-- with cost_cents NULL is UNPRICED, which is not the same as free: the P&L leaves it out
-- of the pool and reports how many it left out.
--
-- WHY location_id IS NOT A COST ATTRIBUTION. It records the building the worker NAMED
-- ("the mop for Neuhaus"), because that is the one thing they actually know and it is
-- useful context for the admin deciding whether to order. It is NOT what the P&L splits
-- on: decision-6 chose pro-rata by labour hours and explicitly REJECTED "worker assigns
-- to building" (option B — "nobody will do it"). Materials are shared across buildings;
-- the building a bottle was requested for is not the building it gets used in. Anything
-- that starts charging cost_cents to location_id is overturning decision-6 and needs a
-- new decision record first.
--
-- ordered_at IS THE PERIOD PIN. A cost belongs to the month we committed the money in,
-- not the month the worker asked or the month the box turned up. It is also why a later
-- invoice correction (editing cost_cents) lands in the right past period instead of
-- silently moving a spend forward.
--
-- seen_at = the worker acknowledged the arrival. There is NO PUSH in this system: the
-- server deps are pg + @sentry/node and nothing else (decision-23 amending decision-16),
-- so the clients POLL and show a banner for `status = 'arrived' AND seen_at IS NULL`.
-- ---------------------------------------------------------------------------
CREATE TABLE material_requests (
  id                BIGSERIAL PRIMARY KEY,
  worker_id         BIGINT NOT NULL REFERENCES workers(id),
  location_id       UUID REFERENCES locations(id),   -- context only, never a cost split
  body              TEXT NOT NULL,                   -- the worker's own words
  status            TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted', 'approved', 'ordered', 'arrived', 'rejected')),
  admin_note        TEXT,
  inventory_item_id BIGINT REFERENCES inventory_items(id),
  quantity          INTEGER CHECK (quantity > 0),
  cost_cents        INTEGER CHECK (cost_cents >= 0),  -- ACTUAL cost; NULL = unpriced
  decided_by        BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  ordered_at        TIMESTAMPTZ,                      -- the period the cost belongs to
  arrived_at        TIMESTAMPTZ,
  seen_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "my requests, newest first" — GET /material-requests/mine, the only worker-facing read.
CREATE INDEX material_requests_worker_idx ON material_requests (worker_id, created_at DESC);

-- The admin's queue. Partial, so it stays the size of the actual backlog rather than the
-- size of history.
CREATE INDEX material_requests_open_idx ON material_requests (created_at)
  WHERE status IN ('submitted', 'approved', 'ordered');

-- The P&L material pool is a range scan on ordered_at. Partial for the same reason.
CREATE INDEX material_requests_ordered_idx ON material_requests (ordered_at)
  WHERE ordered_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- location_contracts — what a building was priced at, WHEN.
--
-- Today locations.monthly_contract_cents is a single mutable number, so raising a price
-- in September silently rewrites every earlier month's revenue. A period-scoped row means
-- a March P&L uses the March price.
--
-- valid_from / valid_to are VIENNA CALENDAR DATES, half-open [valid_from, valid_to).
-- valid_to NULL = the current contract. DATE and not timestamptz on purpose: a contract
-- changes on a day, not at an instant, and a date has no DST to get wrong.
--
-- valid_to >= valid_from, not >. A zero-length row (from = to) is the honest record of a
-- price that was entered and cleared the same day: it contributes zero days of revenue and
-- it does not disappear from history.
--
-- Non-overlap beyond "at most one current" is enforced in routes/admin.js, not by an
-- EXCLUDE constraint. ponytail: an EXCLUDE needs btree_gist, and installing a Postgres
-- extension on a live payroll box is not worth one guarded INSERT. CEILING: two admins
-- posting contract periods concurrently could interleave. There is one admin. UPGRADE
-- PATH: CREATE EXTENSION btree_gist + EXCLUDE USING gist (location_id WITH =, daterange
-- WITH &&).
--
-- client_id is stored, not derived: locations.client_id is current-only, and "who was
-- paying for this building in March" is precisely the question history has to answer.
-- ---------------------------------------------------------------------------
CREATE TABLE location_contracts (
  id                       BIGSERIAL PRIMARY KEY,
  location_id              UUID NOT NULL REFERENCES locations(id),
  client_id                BIGINT REFERENCES clients(id),
  monthly_contract_cents   INTEGER NOT NULL CHECK (monthly_contract_cents >= 0),
  target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0),
  valid_from               DATE NOT NULL,
  valid_to                 DATE,
  note                     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT location_contracts_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- At most ONE current contract per building. Partial, so superseded rows pile up freely.
CREATE UNIQUE INDEX location_contracts_one_current_idx
  ON location_contracts (location_id) WHERE valid_to IS NULL;

-- "the price in force on day D" — the only way the P&L reads this table.
CREATE INDEX location_contracts_period_idx ON location_contracts (location_id, valid_from);

-- BACKFILL. Idempotent: the NOT EXISTS makes a re-run (or a hand-applied fix) a no-op.
-- Only buildings that already carry a price get a row — NULL means "nobody has told me",
-- and inventing a EUR 0 contract for those would turn "unknown" into "100% loss".
INSERT INTO location_contracts (location_id, client_id, monthly_contract_cents,
                                target_minutes_per_month, valid_from, note)
SELECT l.id, l.client_id, l.monthly_contract_cents, l.target_minutes_per_month,
       (l.created_at AT TIME ZONE 'Europe/Vienna')::date,
       'Backfilled from locations by migration 005'
  FROM locations l
 WHERE l.monthly_contract_cents IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM location_contracts c WHERE c.location_id = l.id);

-- ---------------------------------------------------------------------------
-- app_settings — operator-set numbers that this codebase must NOT invent.
--
-- The one key that exists today is `pl_margin_baseline_bp`: the margin floor, in BASIS
-- POINTS (integer, 1500 = 15%). NO DEFAULT ROW IS INSERTED, and that is the point. Nobody
-- has told us what "ineffective" means for a Viennese cleaning contract, so with the key
-- absent the P&L flags NOTHING and says "Zielmarge nicht gesetzt". A hardcoded 15% would
-- be this file having an opinion about someone else's business.
--
-- NOT ops/branding.json: decision-24 §9 draws that line — branding.json is operator
-- IDENTITY, generated into committed well-known files. A margin target is operational
-- data the director changes from the panel, and it is not a credential either.
--
-- ponytail: a key/value table, not a settings framework. CEILING: no types (the route
-- validates), no per-building override, no history. UPGRADE PATH: a typed column per
-- setting once there are three of them.
-- ---------------------------------------------------------------------------
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (btrim(value) <> ''),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- locations — three facts about geocoding, none of which can be derived.
--
--   geocoded_at         WHEN we last asked Google. With lat this gives the coarse state
--                       the map needs, so no boolean is stored for it:
--                         geocoded_at IS NULL                -> never attempted
--                         geocoded_at IS NOT NULL, lat NULL  -> attempted, no pin
--                         lat IS NOT NULL                    -> pinned
--   geocode_status      WHAT happened, in Google's own fixed vocabulary plus a few of
--                       ours ('OK', 'ZERO_RESULTS', 'PARTIAL_MATCH', 'APPROXIMATE_ONLY',
--                       'REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'no_key', 'timeout',
--                       'network:...'). NOT derivable from the two above, and it is the
--                       difference between "fix the address you typed" and "try again
--                       later" — two problems with different owners that otherwise look
--                       identical on screen. See lib/geocode.js for why PARTIAL_MATCH and
--                       APPROXIMATE_ONLY exist: Google answers HTTP 200 / status OK for a
--                       nonsense address and hands back the centre of the postal district,
--                       which would have become a confident marker on the map.
--   street_view_status  what the Street View METADATA endpoint answered. Stored because it
--                       is the only way to know coverage: the static image endpoint
--                       returns a grey "no imagery" JPEG with HTTP 200, so a browser
--                       onError handler alone silently ships a grey box and calls it a
--                       photograph of the building. Render a photo ONLY when this is 'OK'.
--
-- All NULLable — every building on the live box predates them, and geocoding FAILS SOFT:
-- no key, a quota error or a timeout must never block creating a building. A building
-- without a pin is fine; a building you cannot save is not (same rule as decision-23:
-- telemetry never blocks a clock-in).
-- ---------------------------------------------------------------------------
ALTER TABLE locations
  ADD COLUMN geocoded_at        TIMESTAMPTZ,
  ADD COLUMN geocode_status     TEXT,
  ADD COLUMN street_view_status TEXT;
