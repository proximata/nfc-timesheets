-- 007_operator_identity.sql — an operator, and the registry that makes a phone number
-- unique across two kinds of person (decision-45).
--
-- THE OWNER, VERBATIM (ops/workflows/ITERATIONS.md):
--   "An OPERATOR is identified by PHONE NUMBER. Multiple operator phones allowed.
--    Operator phones and worker phones live in ONE namespace and may never collide, so
--    the uniqueness has to be enforced by the database, not by a screen. An operator is
--    NOT a cleaner: no clock-in, no clock-out. He reads and writes tags."
--
-- NO BEGIN/COMMIT here — migrate.js runs each file with `psql -1`, so the file plus its
-- schema_migrations row is already one transaction (see 001_init.sql). ADDITIVE ONLY:
-- workers and admins get ZERO changes — no column, no constraint, no default touched.
--
-- ZERO ROWS ARE CREATED HERE, same convention 006 states for zones/location_revenue: a
-- migration does not get to invent an operator any more than it gets to invent a wage.
--
-- Full design: backlog/docs/OPERATOR-MODEL.md §2-§7. Decision: decision-45 (PROPOSED —
-- this migration is buildable independently of decision-41's ruling; see §2.1 for why the
-- table boundary is exactly what makes that true).

-- ===========================================================================
-- operators — a person who reads and writes tags. Never clocks in: no route reachable
-- with an operator session opens or closes a shift, full stop (§3 of OPERATOR-MODEL.md).
-- No hourly_rate_cents column exists here and none should ever be added — a rate is a
-- WAGE FOR CLEANING, and an operator who never cleans has none to record. A person who
-- does both holds TWO rows, linked by ONE phone_identities entry, and the rate lives on
-- their `workers` row only.
-- ===========================================================================
CREATE TABLE operators (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,  -- audit only, same idiom
                                                                 -- as workers.enrolment_code_issued_by

  -- ENROLMENT CODE COLUMNS, VERBATIM FROM 004 (decision-26), NOT REINVENTED. Same shape,
  -- same hashing (SHA-256 via lib/auth.js hashToken — never scrypt, for the same reason
  -- 004 gives: this is a 40-bit CSPRNG bearer secret behind short expiry + single use +
  -- rate limiting, not a password), same pair constraint. This is the W1 login mechanism:
  -- an admin issues an operator a code exactly as they issue a worker one today, on the
  -- SAME screen shape, and W5 retires BOTH at once.
  enrolment_code_hash        TEXT UNIQUE,
  enrolment_code_expires_at  TIMESTAMPTZ,
  enrolment_code_issued_at   TIMESTAMPTZ,
  enrolment_code_issued_by   BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  enrolment_code_redeemed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE operators ADD CONSTRAINT operators_enrolment_code_pair
  CHECK ((enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL));

-- ===========================================================================
-- phone_identities — THE constraint. One phone, one row, at least one owner. This table
-- and not a UNIQUE(phone) column on two tables is what makes the collision the owner
-- described IMPOSSIBLE rather than merely checked: the second conflicting INSERT hits this
-- PK inside the SAME transaction that would have created the second person, and the whole
-- transaction rolls back. Same idiom as zones_tag_serial_idx (decision-44) and
-- shifts_one_open_per_worker_idx (001) — uniqueness the database owns, not the API.
--
-- worker_id / operator_id: BOTH nullable, BOTH UNIQUE (so a phone claims at most one
-- workers row and at most one operators row — never two of the same kind), and the CHECK
-- below forbids the empty row. A phone_identities row with BOTH set is not a bug, it is
-- the owner-cleans-a-building case (§3): one person, one number, two capabilities.
--
-- ON DELETE SET NULL, not CASCADE: deleting a workers or operators row must not delete the
-- OTHER half of a linked identity, and must not silently free a phone number for reuse
-- while its sibling row still exists holding half a claim. A row that decays to both NULL
-- is caught by the CHECK on the next write and is a bug to investigate, not a state to
-- leave standing — ops runs `DELETE FROM phone_identities WHERE worker_id IS NULL AND
-- operator_id IS NULL` as routine cleanup, same spirit as the sessions sweep in
-- lib/auth.js. (ops/reset-w1.sql does exactly this, explicitly, immediately before it
-- deletes workers — see that file for why the ON DELETE SET NULL action forces it.)
-- ===========================================================================
CREATE TABLE phone_identities (
  phone_e164   TEXT PRIMARY KEY CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  worker_id    BIGINT UNIQUE REFERENCES workers(id)   ON DELETE SET NULL,
  operator_id  BIGINT UNIQUE REFERENCES operators(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)
);

-- "which person owns this phone" — the ONLY read this table exists to answer, and (once
-- W5 exists) the first query an inbound SMS login does.
CREATE INDEX phone_identities_worker_idx   ON phone_identities (worker_id)   WHERE worker_id   IS NOT NULL;
CREATE INDEX phone_identities_operator_idx ON phone_identities (operator_id) WHERE operator_id IS NOT NULL;

-- ===========================================================================
-- operator_sessions — byte-for-byte the shape of worker_sessions (002). Two tables, two
-- cookie names, no shared failure mode — the same reasoning 002 gives for not overloading
-- `sessions` (admin_id NOT NULL there; a nullable admin_id plus a discriminator column is
-- how a worker cookie ends up satisfying an admin route by accident).
-- ===========================================================================
CREATE TABLE operator_sessions (
  token       TEXT PRIMARY KEY,      -- SHA-256(token) — see hashToken, never the raw value
  operator_id BIGINT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX operator_sessions_expires_at_idx ON operator_sessions (expires_at);
CREATE INDEX operator_sessions_operator_id_idx ON operator_sessions (operator_id);

-- workers, admins: ZERO CHANGES. No column added, no constraint touched.
