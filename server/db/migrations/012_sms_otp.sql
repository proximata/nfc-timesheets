-- 012_sms_otp.sql — the one-time code a worker receives by SMS and types once.
--
-- decision-48 §6, backlog/docs/SMS-ONBOARDING.md §6.5. This file exists NOW and not
-- earlier for exactly one reason the doc states as a rule: "a migration with no writer is
-- dead weight". Its writer is POST /auth/sms/request and its reader is POST /auth/sms/verify,
-- both landed in the same commit range as this file.
--
-- NO BEGIN/COMMIT: migrate.js runs each file with `psql -1`.
-- ADDITIVE ONLY. Nothing existing is altered — not workers, not operators, not
-- phone_identities, not worker_sessions, not 011's sms_deliveries.
--
-- THIS IS NOT A THIRD IDENTITY SYSTEM. A redeemed challenge ends in the SAME
-- `createWorkerSession()` call, the SAME `worker_sessions` row, the SAME `ts_worker`
-- cookie and the SAME 90-day TTL that Sign in with Apple (decision-22) and the enrolment
-- code (decision-26) already mint. Nothing downstream can tell which door was used, and
-- worker_id still comes from the session and never from a request body.
--
-- IT REPLACES NOTHING. decision-48 amends the "SMS replaces enrolment codes" clause in
-- ITERATIONS.md and decision-45 §6: the enrolment code is not deprecated, not hidden and
-- not made harder to reach by anything here or in 011.

-- ===========================================================================
-- otp_challenges — one row per code we sent, and the state that makes it single-use.
--
-- SIX DIGITS, TEN MINUTES, FIVE ATTEMPTS. The arithmetic lives in the code that mints it
-- (lib/sms.js OTP_* constants and SMS-ONBOARDING.md §6.2) and is bounded by ATTEMPTS, not
-- by time: an OTP guess is checked against the ONE challenge minted for the phone number
-- in the same request, never against a shared space, so there is no union to attack and
-- 10^6 is ample. That is precisely why this credential may be six digits while the
-- enrolment code needs forty bits (decision-26 — its search space IS shared).
-- If the length, the TTL, the attempt cap or either rate limit changes, redo §6.2.
-- ===========================================================================
CREATE TABLE otp_challenges (
  id           BIGSERIAL PRIMARY KEY,

  -- FK to the registry and nowhere else: a challenge can only ever exist for a number that
  -- is already ONE identity across workers and operators (007, decision-45). ON DELETE
  -- CASCADE because a released phone claim must take its live challenges with it — a code
  -- outliving the claim it was minted against would be a credential for a number this
  -- system no longer recognises.
  phone_e164   TEXT NOT NULL REFERENCES phone_identities(phone_e164) ON DELETE CASCADE,

  -- SHA-256 via lib/auth.js hashToken — the ONE hash helper every bearer token in this
  -- system uses (sessions, worker_sessions, portal_grants, enrolment codes). Never scrypt,
  -- for the reason 004 gives: this is a short-lived CSPRNG secret behind an expiry, a
  -- single use, an attempt cap and three rate limiters, not a password.
  code_hash    TEXT NOT NULL,

  expires_at   TIMESTAMPTZ NOT NULL,

  -- Wrong answers so far. The cap is enforced in the SAME statement that redeems, so it is
  -- the database that decides, not a branch in this process (see below).
  attempts     SMALLINT NOT NULL DEFAULT 0,

  -- NULL = still live. Stamped by redemption, and never cleared.
  consumed_at  TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "The newest live challenge for this number" — the only lookup verify performs.
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone_e164, created_at DESC);

-- Sweeping expired rows. Same opportunistic-delete idiom as worker_sessions' expiry index.
CREATE INDEX otp_challenges_expires_idx ON otp_challenges (expires_at);

-- REDEMPTION IS ONE STATEMENT, DECIDED BY THE DATABASE, exactly as POST /auth/code does it:
--
--   UPDATE otp_challenges SET consumed_at = now()
--    WHERE id = $1 AND code_hash = $2 AND expires_at > now()
--      AND consumed_at IS NULL AND attempts < 5
--   RETURNING id
--
-- Under READ COMMITTED the second of two racing verifications blocks on the row lock,
-- re-evaluates its WHERE against the committed row, finds consumed_at set and updates
-- nothing. An `if (already_consumed)` in the process could not do that — both racers would
-- read "live" and both would mint a session.
