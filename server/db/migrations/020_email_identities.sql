-- 020_email_identities.sql — EMAIL IS A THIRD LOGIN DOOR (decision-64, TASK-320).
--
-- THE OWNER ASKED FOR EMAIL AUTH PLUS EMAIL FIELDS. decision-64 settles the shape by
-- pointing at the one this system already has: phone login is NOT a column on
-- workers/operators, it is a REGISTRY (007's phone_identities) plus a live-code table
-- (012's otp_challenges), because a phone number moves between people and needs claim and
-- release semantics. An email address has the same shape of problem, so this file is 007 +
-- 012 with `phone_e164` replaced by `email` and nothing else invented.
--
-- `workers.email` (002, the Sign-in-with-Apple eligibility column) IS NOT TOUCHED, NOT
-- READ AND NOT REUSED BY ANY OF THIS. decision-50 retired Apple sign-in, so that column is
-- vestigial; decision-64 leaves it exactly as it is rather than quietly repurposing a
-- column whose UNIQUE constraint and lower-case CHECK were written for a different
-- question. The login address lives HERE and nowhere else — the same sentence 011 wrote
-- about refusing a second `workers.phone_e164`.
--
-- NO BEGIN/COMMIT here — migrate.js runs each file with `psql -1`, so the file plus its
-- schema_migrations row is already one transaction (see 001_init.sql).
--
-- ADDITIVE ONLY. workers, operators, admins, phone_identities and otp_challenges get ZERO
-- changes: no column, no constraint, no default touched.
--
-- ZERO ROWS ARE CREATED HERE, same convention 006/007/010/011 state: a migration does not
-- get to invent an identity any more than it gets to invent a wage.

-- ===========================================================================
-- email_identities — one address, one row, exactly one owner.
--
-- Same idiom as phone_identities (007): the uniqueness is the DATABASE'S, not the API's, so
-- a second conflicting INSERT hits this PRIMARY KEY inside the SAME transaction that would
-- have created the second claim and the whole transaction rolls back.
--
-- ONE DELIBERATE DIVERGENCE FROM 007, AND IT IS WRITTEN DOWN BECAUSE IT IS A CEILING:
-- phone_identities' CHECK is "at least one owner", so ONE row can carry BOTH a worker and
-- an operator claim — the owner-cleans-a-building case (007 §3, one human, one number, two
-- capabilities). decision-64 §1 specifies EXACTLY ONE for email, so that case is NOT
-- representable here: a person who is both a worker and an operator needs two addresses (or
-- two plus-tags on one mailbox) to hold both doors.
-- ponytail: following the decision as written rather than silently "improving" it.
-- CEILING: one human with one mailbox cannot hold both roles' email doors.
-- UPGRADE PATH: relax this CHECK to phone_identities' "at least one" and make
-- putWorkerEmail/putOperatorEmail adopt the other half the way putWorkerPhone already does
-- — a one-line CHECK change plus an ON CONFLICT branch, and its own decision record.
--
-- LOWERCASE IS AN INVARIANT, not a convention — the same rule 002 states for workers.email
-- and for the same reason: the login route lower-cases before it looks the address up, so a
-- row stored as "Anna@Example.at" would simply never match and the person would be locked
-- out with nothing visibly wrong. Enforced in two places on purpose: lib/validate.js's
-- identityEmail normalises everything the API accepts, and the CHECK below is the backstop
-- for anything written by hand with psql.
--
-- The shape regex is the SAME deliberately-loose one lib/validate.js uses (one @, something
-- either side, a dot in the domain, no whitespace and no comma). A regex cannot decide
-- whether an address is deliverable and the strict RFC 5322 grammar rejects real addresses
-- people actually have; this catches the realistic admin typo and nothing more.
--
-- ON DELETE SET NULL, not CASCADE, verbatim from 007: deleting a workers or operators row
-- must not silently free an address for reuse. Under this table's stricter CHECK a row that
-- decays to all-NULL is unrepresentable, so the release path is a DELETE (see
-- routes/admin.js releaseWorkerEmail) and the ON DELETE SET NULL branch is reachable only by
-- a HARD delete of a person, which this system does not do (it soft-deletes with
-- active = false). Kept anyway, because matching 007 costs nothing and diverging invites a
-- reader to assume the two tables behave differently in ways they do not.
-- ===========================================================================
CREATE TABLE email_identities (
  email       TEXT PRIMARY KEY
              CHECK (email = lower(email))
              CHECK (email ~ '^[^\s@,]+@[^\s@,.]+(\.[^\s@,.]+)+$')
              CHECK (length(email) <= 320),  -- RFC 5321 practical maximum, same as validate.js
  worker_id   BIGINT UNIQUE REFERENCES workers(id)   ON DELETE SET NULL,
  operator_id BIGINT UNIQUE REFERENCES operators(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- EXACTLY ONE (decision-64 §1). See the divergence note above.
  CONSTRAINT email_identities_one_claim
    CHECK ((worker_id IS NOT NULL) <> (operator_id IS NOT NULL))
);

-- "which person owns this address" — the ONLY read this table exists to answer, and the
-- first query an email sign-in does. Partial, same as 007's pair.
CREATE INDEX email_identities_worker_idx   ON email_identities (worker_id)   WHERE worker_id   IS NOT NULL;
CREATE INDEX email_identities_operator_idx ON email_identities (operator_id) WHERE operator_id IS NOT NULL;

-- ===========================================================================
-- email_challenges — one row per code we sent, and the state that makes it single-use.
--
-- 012's otp_challenges, transcribed, with `email` where `phone_e164` was. SIX DIGITS, TEN
-- MINUTES, FIVE ATTEMPTS — the same numbers, and 012's arithmetic carries over unchanged
-- because it is bounded by ATTEMPTS, not by channel: a guess is checked against THE ONE
-- challenge minted for that address in the same request, never against a shared space, so
-- there is no union to attack and 10^6 is ample. (This is exactly why decision-63's
-- low-entropy argument for the enrolment code does not apply here, and decision-64 §3 says
-- so explicitly.)
--
-- A SEPARATE TABLE AND NOT A NULLABLE `email` COLUMN ON otp_challenges: that table's
-- phone_e164 is NOT NULL and FK'd to phone_identities, so adding email would mean making an
-- existing NOT NULL column nullable, adding a second FK and a discriminator — the exact
-- shape 002 refused when it declined to overload `sessions`. Two tables, two FKs, no shared
-- failure mode.
--
-- THIS IS NOT A FOURTH IDENTITY SYSTEM. A redeemed challenge ends in the SAME
-- createWorkerSession()/createOperatorSession() call, the SAME sessions row, the SAME
-- ts_worker/ts_operator cookie and the SAME 90-day TTL every other door mints. Nothing
-- downstream can tell which door was used, and worker_id still comes from the session and
-- never from a request body (decision-22's structural half).
--
-- ON DELETE CASCADE for the same reason 012 gives: a released claim must take its live
-- challenges with it, or a code outlives the claim it was minted against.
-- ===========================================================================
CREATE TABLE email_challenges (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL REFERENCES email_identities(email) ON DELETE CASCADE,

  -- SHA-256 via lib/auth.js hashToken — the ONE hash helper every bearer token in this
  -- system uses. Never scrypt, for 004's reason: a short-lived CSPRNG secret behind an
  -- expiry, a single use, an attempt cap and rate limiters is not a password.
  code_hash   TEXT NOT NULL,

  expires_at  TIMESTAMPTZ NOT NULL,
  -- Wrong answers so far. The cap is enforced in the SAME statement that redeems, so it is
  -- the database that decides, not a branch in this process (012's redemption note).
  attempts    SMALLINT NOT NULL DEFAULT 0,
  -- NULL = still live. Stamped by redemption, never cleared.
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "The newest live challenge for this address" — the only lookup verify performs.
CREATE INDEX email_challenges_email_idx ON email_challenges (email, created_at DESC);
-- Sweeping expired rows, the same opportunistic-delete idiom 012 uses.
CREATE INDEX email_challenges_expires_idx ON email_challenges (expires_at);

-- REDEMPTION IS ONE STATEMENT, DECIDED BY THE DATABASE, verbatim from 012:
--
--   UPDATE email_challenges SET consumed_at = now()
--    WHERE id = $1 AND code_hash = $2 AND expires_at > now()
--      AND consumed_at IS NULL AND attempts < 5
--   RETURNING id
--
-- Under READ COMMITTED the second of two racing verifications blocks on the row lock,
-- re-evaluates its WHERE against the committed row, finds consumed_at set and updates
-- nothing. An `if (already_consumed)` in this process could not do that.
--
-- NO email_deliveries TABLE. 011 exists because the owner asked to SEE whether an SMS was
-- attempted, and because a carrier rejection is otherwise invisible; nothing in decision-64
-- asks for that here, and "a migration with no writer is dead weight" (012's own rule).
-- ponytail CEILING: a bounced email is invisible to the panel. UPGRADE PATH: an
-- email_deliveries table shaped like 011's, plus a Resend webhook — its own decision,
-- because a webhook opens a public route.
