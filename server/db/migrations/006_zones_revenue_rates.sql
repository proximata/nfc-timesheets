-- 006_zones_revenue_rates.sql — zones, typed revenue, and a wage that cannot be zero.
--
-- THREE owner decisions in one file, applied to an ALMOST-EMPTY production database
-- (1 building, 1 leftover test worker, 0 shifts) on purpose: this is the cheapest moment
-- there will ever be.
--   decision-41  a worker's hourly rate is REQUIRED and strictly positive
--   decision-42  revenue is a typed, append-only monthly fact per building
--   decision-43  zones, with area; SUPERSEDES decision-37
--   decision-44  a tag serial is data on a zone (the column lives here)
--
-- ONE file and not three: all three land before the client onboards, migrate.js applies
-- files atomically one at a time with `psql -1`, and three files would create three
-- half-migrated states to reason about. The rate guard raises FIRST, so a database that
-- cannot satisfy it gets nothing at all.
--
-- ADDITIVE ONLY. 001-005 are APPLIED ON THE LIVE BOX and are not editable
-- (db/README.md). No column is dropped, no column changes type, every added column is
-- NULLable or DEFAULTed. NO BEGIN/COMMIT — migrate.js already runs each file with
-- `psql -1`. No down-migration: a reversal is a new numbered file.
--
-- MONEY IS INTEGER CENTS. AREA IS NUMERIC, never a float — same exact-decimal discipline
-- as money, because it becomes the DENOMINATOR of a EUR/m2 figure a director quotes from.

-- ===========================================================================
-- 1 · decision-41 — a wage of zero is not a wage.
--
-- 001_init.sql:25 declares `hourly_rate_cents INTEGER NOT NULL DEFAULT 0`, so a worker
-- created without a rate becomes a worker who costs EUR 0,00/h, silently, at the moment
-- of creation. Every rate-less defect in this system descends from that.
--
-- DROP DEFAULT is the load-bearing half and is the easiest line to forget: NOT NULL with
-- DEFAULT 0 still silently lands a zero on any INSERT that omits the column, which is the
-- shape of seed.sql and of every fixture in check-api.js. Without the default, an omitted
-- column raises 23502 at the point of the mistake.
--
-- `> 0`, not `>= 0`: unlike a client contract, a wage has no "free of charge" reading.
-- The Austrian collective agreement for building cleaning sets a floor well above zero.
--
-- THE GUARD REFUSES RATHER THAN INVENTING. A migration does not get to choose somebody's
-- wage, and it does not get to deactivate them to avoid the question. `psql -1` aborts
-- the file, migrate.js records nothing, and the database is left exactly as it was;
-- re-running after the rates are set applies it.
--
-- NO EXEMPTION FOR INACTIVE WORKERS. `CHECK (... OR NOT active)` was rejected in
-- decision-41: the hole is reachable (deactivate, set 0, and the row can never be
-- reactivated without an edit nobody expects).
--
-- KNOWN AT THE TIME OF WRITING: production carries exactly one such row — worker id 6,
-- 'TTL Test', rate 0, already inactive, with no shifts, no material requests and no
-- sessions. THIS MIGRATION WILL REFUSE UNTIL A HUMAN DEALS WITH IT. That is the designed
-- behaviour, not an oversight; see server/db/README.md for the one-line ops step.
-- ===========================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workers WHERE hourly_rate_cents <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('%s worker(s) have no hourly rate; refusing to invent one.', n),
      HINT    = 'Set every rate on /workers/ (or remove the leftover row), then re-run migration 006.';
  END IF;
END $$;

ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;
ALTER TABLE workers ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);

-- ===========================================================================
-- 2 · decision-42 — what the client PAID, per building, per Vienna month.
--
-- NOT an accrual. location_contracts holds what was AGREED (a rate, with a validity
-- range); this holds what was RECEIVED (a scalar, for one named month). The P&L stops
-- pro-rating a monthly fee across arbitrary day ranges and starts reading a figure a
-- human typed.
--
-- THE ABSENCE OF A ROW IS THE UNKNOWN. amount_cents is NOT NULL and 0 is expressible and
-- MEANS SOMETHING — "they paid nothing this month" (a credit month, a dispute, a free
-- trial) is a real, DIFFERENT answer from "nobody has told me". A nullable amount would
-- push that distinction into four read sites instead of one.
--
-- APPEND-ONLY. Hand-typed money that changes invisibly is an opinion, not a fact. A
-- correction INSERTs a new row and stamps superseded_at on the old one; a retraction
-- stamps superseded_at and inserts nothing, so the month reverts to UNKNOWN rather than
-- to 0. Same idiom the schema already runs twice: location_contracts_one_current_idx and
-- portal_grants_one_live_idx.
-- ===========================================================================
CREATE TABLE location_revenue (
  id             BIGSERIAL PRIMARY KEY,
  location_id    UUID NOT NULL REFERENCES locations(id),
  month          DATE NOT NULL,                    -- always the 1st; a Vienna calendar month
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  note           TEXT,
  entered_by     BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,                      -- NULL = the figure in force
  superseded_by  BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  -- A DATE has no DST to get wrong (005's reasoning for valid_from/valid_to). EXTRACT is
  -- used rather than date_trunc(...)::date so there is no doubt about IMMUTABLE inside a
  -- CHECK — a non-immutable expression there is refused at CREATE TABLE time.
  CONSTRAINT location_revenue_month_start CHECK (EXTRACT(DAY FROM month) = 1)
);

-- At most ONE figure in force per (building, month). Partial, so superseded rows pile up
-- freely and the whole correction history survives.
CREATE UNIQUE INDEX location_revenue_one_live_idx
  ON location_revenue (location_id, month) WHERE superseded_at IS NULL;

-- The /pl/ month grid reads a period across every building: (month, location_id).
CREATE INDEX location_revenue_month_idx ON location_revenue (month, location_id);

-- NO BACKFILL FROM location_contracts. A contract is what was AGREED; copying it in would
-- assert a payment that may never have arrived — the accrual decision-42 removes, wearing
-- a different hat. The contract is offered as a SUGGESTION in the entry form and is
-- stored only when a human presses save.

-- ===========================================================================
-- 3 · decision-43 — zones.
--
-- WHAT A ZONE IS: a place inside a building that gets cleaned and can carry a tag.
-- WHAT A ZONE IS NOT: a costing unit. A shift is billed to the BUILDING, and the contract
-- and the revenue stay on the BUILDING.
--
-- NO tags table: decision-5 made our own tags identity-free (the id is in the URI, not
-- the hardware UID), so the only hardware with an identity worth storing is an ADOPTED
-- third-party tag, whose sole stable handle is its serial — one column (decision-44).
--
-- area_sqm IS NULLABLE ON PURPOSE. A zone nobody has measured is real ("Stiege 3, there
-- is no floor plan"), and a required area would be an INVENTED one, which poisons the
-- EUR/m2 benchmark that is the only reason the column exists. NULL is not 0 either: the
-- building total renders as "mindestens 420 m2 (2 von 5 Zonen ohne Fläche)", never as a
-- total pretending completeness.
--
-- THE BUILDING STORES NO AREA. SUM(zones.area_sqm) is derived at read time — 005's
-- standing rule that a derivable fact is not stored, because a stored copy drifts the
-- first time a zone is resized.
--
-- ZERO ROWS ARE CREATED HERE. A building with no zones behaves exactly as it does today
-- and its own UUID keeps resolving FOR EVER — the card physically on the wall at HOIV
-- carries one. "Unzoned" is a PRESENTATION state (grey on the map); it is NOT
-- locations.active and must never be wired to tap resolution.
-- ===========================================================================
CREATE TABLE zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  note            TEXT,                                  -- where the tag physically is
  area_sqm        NUMERIC(8,2) CHECK (area_sqm > 0),     -- NULL = nobody has measured it

  -- ADOPTED HARDWARE ONLY (decision-44). A tag WE wrote has no row here: it carries this
  -- zone's id in its URL. This column exists because the tag at HOIV holds no URL at all
  -- and cannot be rewritten (46 B NDEF capacity, our URI needs ~64 B).
  -- A SERIAL IS NOT A CREDENTIAL (decision-15): it is broadcast in the clear and is
  -- clonable. It never reaches the server on a tap — the phone matches it against the
  -- cached roster and sends the RESOLVED place UUID, which the server resolves itself,
  -- with the worker taken from the session (decision-22). Nothing may ever authenticate
  -- on this value.
  tag_serial      TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),

  -- NOT DERIVABLE, which is why it is stored: "a tag is on this wall and has never been
  -- tapped" and "there is no tag on this wall" are different states. LAST-tap time is NOT
  -- stored — that one IS derivable, from shifts.
  tag_deployed_at TIMESTAMPTZ,

  active          BOOLEAN NOT NULL DEFAULT true,         -- soft only; nothing destroys history
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zones_location_id_idx ON zones (location_id);

-- Two live zones called "Stiege 1" in one building is a director about to tag the wrong
-- door. Partial + lower(btrim(...)) so a deactivated zone frees its name and "stiege 1"
-- cannot slip past "Stiege 1".
CREATE UNIQUE INDEX zones_one_live_name_idx
  ON zones (location_id, lower(btrim(name))) WHERE active;

-- One adopted serial can only mean one place. The route answers 409 naming the other
-- zone; this is the backstop that makes the ambiguity unrepresentable.
CREATE UNIQUE INDEX zones_tag_serial_idx ON zones (tag_serial) WHERE tag_serial IS NOT NULL;

-- The target of the composite FKs below. Redundant with the primary key by itself, and
-- that is exactly what makes (id, location_id) referenceable.
ALTER TABLE zones ADD CONSTRAINT zones_id_location_key UNIQUE (id, location_id);

-- ---------------------------------------------------------------------------
-- shifts — two TAP FACTS, nullable, never an input to money.
--
-- NULL = a building-level tag was tapped, or the shift predates zones. One predicate, no
-- third flag (001's rule, and decision-10's lesson).
--
-- TWO columns and not one: a single zone_id cannot answer "which door do people actually
-- leave by", which is the maintenance question the `note` column exists for.
--
-- COMPOSITE FKs, MATCH SIMPLE (the default): with location_id NOT NULL and the zone
-- column NULLable, the constraint is NOT checked while the zone is NULL and is FULLY
-- checked once it is set — so the database itself makes it impossible for a shift to name
-- another building's zone.
-- CONSEQUENCE, and it is not optional: PATCH /admin/shifts/:id must CLEAR both zone
-- columns when location_id changes, or the update raises 23503. Clearing is also the
-- correct semantics — a human re-pointing a shift is saying the tap record was wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE shifts
  ADD COLUMN start_zone_id UUID,
  ADD COLUMN end_zone_id   UUID,
  ADD CONSTRAINT shifts_start_zone_fk
    FOREIGN KEY (start_zone_id, location_id) REFERENCES zones (id, location_id),
  ADD CONSTRAINT shifts_end_zone_fk
    FOREIGN KEY (end_zone_id, location_id)   REFERENCES zones (id, location_id);

-- "when was this tag last tapped" — one row per zone in the building panel. PARTIAL: the
-- column is NULL for all existing history and for every building-level tag, so the index
-- stays the size of the zoned shifts and not of the table.
CREATE INDEX shifts_start_zone_idx ON shifts (start_zone_id, start_time DESC)
  WHERE start_zone_id IS NOT NULL;

-- NO BACKFILL, NO DEFAULT ZONE. `start_zone_id IS NULL` reads as "a building-level tag
-- was tapped, or this predates zones". Payroll, the P&L, analytics, the portal and the
-- autoclose SQL are unchanged byte for byte. Inventing a row named 'Eingang' would assert
-- a tap that never happened and a measurement nobody took — 005 refused the identical
-- move for buildings with no contract figure.
