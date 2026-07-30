-- 003_clients_contracts_inventory.sql — the director's own vocabulary, in the database.
--
-- WHAT THE DIRECTOR ASKED FOR, and where each item landed:
--   "buildings need ... point of contact, company with which contract, monthly contract
--    volume, target time spent"  -> locations.contact_id / client_id /
--                                   monthly_contract_cents / target_minutes_per_month
--   "cleaners need name, phone"  -> workers.phone (name already exists)
--   "products and equipment, each with a cost" -> inventory_items (ONE table)
--   "give the point of contact access to see ... for their building"
--                                -> contacts + portal_grants
--
-- ADDITIVE ONLY. 001 and 002 are APPLIED IN PRODUCTION with live shifts in them and are
-- not editable (db/README.md). Every column added here is NULLable or has a DEFAULT,
-- because rows that predate the column cannot supply a value: a migration that demands
-- one cannot run. The director will fill contract figures in over weeks, building by
-- building, and the panel must keep working the whole time.
--
-- NO BEGIN/COMMIT — migrate.js runs each file with `psql -1`, so the file plus its
-- schema_migrations row is already one transaction (see 001_init.sql).
--
-- MONEY IS INTEGER CENTS. TIME IS INTEGER MINUTES. No float, no NUMERIC for money:
-- contract revenue minus labour cost has to be exact, and 0.1 + 0.2 is not 0.3.

-- ---------------------------------------------------------------------------
-- clients — the company that holds the contract for a building.
-- Soft-deactivated (active = false), never deleted: a building's history has to keep
-- naming who was paying for the cleaning at the time.
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- contacts — a HUMAN at a client. The "point of contact" for one or more buildings.
--
-- `email` is here so the DIRECTOR can recognise the person ("that's the Hausverwaltung
-- lady"). IT IS NOT A LOGIN CREDENTIAL. There is no password column, no session table
-- and no auth path that reads this address — access to the client portal is granted by
-- handing out a link (portal_grants below), never by proving ownership of an inbox.
-- Anyone adding an auth path keyed on this column is inventing an account system that
-- decision-20's reasoning deliberately kept out of reach of non-staff.
--
-- Lower-case invariant matches workers.email so the two can be compared and de-duped
-- without every call site remembering to fold case. Enforced in lib/validate.js
-- (optionalEmail) with this CHECK as the backstop for anything typed into psql.
-- ---------------------------------------------------------------------------
CREATE TABLE contacts (
  id         BIGSERIAL PRIMARY KEY,
  client_id  BIGINT NOT NULL REFERENCES clients(id),
  name       TEXT NOT NULL,
  email      TEXT CHECK (email = lower(email)),
  phone      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "the contacts of this client" — the only way this table is ever read.
CREATE INDEX contacts_client_id_idx ON contacts (client_id);

-- ---------------------------------------------------------------------------
-- workers.phone — the director asked for exactly two fields for a cleaner: name and
-- phone. Free text on purpose: an Austrian mobile written as "+43 664 1234567",
-- "0664/1234567" or "0664 123 45 67" is the same phone, and normalising it would only
-- mean rejecting what the director typed. Never a login credential either.
-- ---------------------------------------------------------------------------
ALTER TABLE workers ADD COLUMN phone TEXT;

-- ---------------------------------------------------------------------------
-- locations — the building. Four new facts, all NULLable.
--
--   client_id                 the company holding the contract
--   contact_id                the point of contact, a human at that client
--   monthly_contract_cents    what we invoice for this building each month
--   target_minutes_per_month  how much cleaning time it is SUPPOSED to take
--
-- WHY THE LAST TWO EXIST: together with the hours already in `shifts` they answer the
-- only two questions the director actually has about a building —
--   "are we overservicing it?"   actual minutes vs target_minutes_per_month
--   "is it profitable?"          monthly_contract_cents vs SUM(hours x hourly_rate_cents)
-- Both plain integers so that arithmetic stays exact and a report is a subtraction, not
-- a rounding argument. (3B layers decision-6's pro-rata material split on top; nothing
-- here needs to change for it.)
--
-- contact_id is NOT NULL-constrained to belong to client_id — a composite FK would
-- force both columns to be filled together, and the director fills them one at a time.
-- routes/admin.js enforces the pairing when both are supplied, and derives client_id
-- from the contact when only the contact is given.
-- ---------------------------------------------------------------------------
ALTER TABLE locations
  ADD COLUMN client_id                BIGINT REFERENCES clients(id),
  ADD COLUMN contact_id               BIGINT REFERENCES contacts(id),
  ADD COLUMN monthly_contract_cents   INTEGER CHECK (monthly_contract_cents >= 0),
  ADD COLUMN target_minutes_per_month INTEGER CHECK (target_minutes_per_month >= 0);

-- "which buildings does this client have" — the client screen, and the only place a
-- deactivation guard can find out what it is about to orphan.
CREATE INDEX locations_client_id_idx ON locations (client_id);

-- ---------------------------------------------------------------------------
-- inventory_items — products AND equipment in ONE table.
--
-- A mop and a bottle of cleaner differ by a LABEL, not by structure: both are a name
-- and a cost. Two tables would mean two admin screens, two forms and two nav entries
-- for the director to keep straight, to model a distinction that is one word wide.
-- `kind` is that word. If products ever grow a field equipment does not have, the
-- honest move is a nullable column here, not a second table.
--
-- unit_cost_cents: integer cents, NOT NULL DEFAULT 0. Zero means "not priced yet",
-- which is a real state when the director is entering a shelf of supplies from memory.
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_items (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('product', 'equipment')),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- portal_grants — read-only client access to ONE building's cleaning history.
--
-- ponytail: A SHAREABLE LINK, NOT AN ACCOUNT.
--   Ladder: (1) needed at all? yes, the director was explicit. (2)/(3) no stdlib or
--   platform answer. (4) already-installed dep: node:crypto + the `sessions` token
--   pattern that is already deployed and tested. (6) minimum code: one table, one
--   route, no new dependency.
--   WHY NOT ACCOUNTS: an account means the director administers passwords for other
--   companies' staff (they will not), and a magic link means running SMTP on the box
--   (a mail server, a domain reputation and a bounce queue we do not have).
--   CEILING: anyone holding the link sees that ONE building's cleaning history —
--   forwarded, screenshotted, pasted into a group chat. Accepted because the payload is
--   deliberately minimal (building name, date, worker FIRST NAME, minutes) and the grant
--   is revocable in one click.
--   UPGRADE PATH: real contact accounts + magic-link email, keyed on contacts.id. This
--   table becomes the legacy path and is dropped once every grant is revoked.
--
-- token_hash IS the primary key and holds SHA-256(token) ONLY — never the token. Same
-- reasoning as sessions/worker_sessions (lib/auth.js): a leaked pg_dump or a read-only
-- SQL hole then yields hashes that cannot be replayed as access. Plain SHA-256 is right
-- here and would be wrong for a password: the token is 32 bytes of CSPRNG output, so
-- there is no dictionary to attack, and a slow KDF on a public unauthenticated route
-- would just be a free DoS lever.
--
-- (contact_id, location_id) is the grant: THIS person may see THAT building. Nothing
-- else. The portal route reads location_id from this row and never from the request, so
-- there is no parameter for an outsider to tamper with.
--
-- revoked_at NULL = live. Revoking is an UPDATE, not a DELETE, so "we stopped sharing
-- this in March" stays answerable.
-- ---------------------------------------------------------------------------
CREATE TABLE portal_grants (
  token_hash  TEXT PRIMARY KEY,
  contact_id  BIGINT NOT NULL REFERENCES contacts(id),
  location_id UUID   NOT NULL REFERENCES locations(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

-- At most ONE live link per (contact, building). "Get link" therefore always means the
-- same thing to the director: the person has exactly one working link, and re-issuing
-- kills the old one. Partial, so revoked grants pile up freely as history.
CREATE UNIQUE INDEX portal_grants_one_live_idx
  ON portal_grants (contact_id, location_id) WHERE revoked_at IS NULL;

-- The admin panel lists grants per building ("who can see this building").
CREATE INDEX portal_grants_location_id_idx ON portal_grants (location_id);
CREATE INDEX portal_grants_contact_id_idx ON portal_grants (contact_id);

-- ---------------------------------------------------------------------------
-- SHIFTS ENTERED BY HAND — NO NEW COLUMN.
--
-- POST /admin/shifts exists because a worker whose phone died worked a real day and
-- must not be paid EUR 0. Such a shift has to be distinguishable from a tapped one
-- (payroll disputes), and the column that ALREADY carries that meaning is client_uuid:
-- it is the iOS app's idempotency key, so every phone-originated shift has one and only
-- a shift no phone ever touched can be NULL.
--
--   client_uuid IS NULL  <=>  typed into the admin panel by a human
--
-- No `manually_added` flag. We removed `needs_correction` for exactly this reason: a
-- second column stating a fact the first one already implies is a column that can drift
-- out of agreement with it. Postgres allows any number of NULLs in a UNIQUE index, so
-- hand-entered shifts do not contend for the key either.
-- ---------------------------------------------------------------------------
