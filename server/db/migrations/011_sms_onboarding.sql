-- 011_sms_onboarding.sql — an append-only record of every SMS this system attempted.
--
-- decision-48, backlog/docs/SMS-ONBOARDING.md §5.2. THE OWNER, VERBATIM:
--
--   "in admin there must be an option to choose how to onboard a worker, so if sms didnt
--    work, there is always a fallback."
--
-- NO BEGIN/COMMIT: migrate.js runs each file with `psql -1`, so the file plus its
-- schema_migrations row is already one transaction (see 001_init.sql).
--
-- ADDITIVE ONLY. workers, operators, admins and phone_identities get ZERO changes — no
-- column, no constraint, no default touched. In particular NO `workers.onboarding_method`
-- and NO `workers.phone_e164`:
--
--   * onboarding is an ACTION the admin takes, not a preference stored on a person
--     (decision-48 §2). Two buttons on one row, both live for every active worker, for
--     ever. A column would be a value some future batch action could branch on, and the
--     day it does, hiding the code path becomes a one-line change made in good faith.
--   * the login number is `phone_identities.phone_e164` (007, decision-45) and nowhere
--     else. A second E.164 column with its own UNIQUE constraint IS a second namespace,
--     and the collision decision-45 made impossible would become possible again — this
--     time silently, because both constraints would be satisfied.
--
-- ZERO ROWS ARE CREATED HERE, same convention 006/007/010 state: a migration does not get
-- to invent a delivery any more than it gets to invent a wage.

-- ===========================================================================
-- sms_deliveries — what HAPPENED, per attempt.
--
-- THIS IS THE TABLE THAT MAKES A "PREFERRED CHANNEL" COLUMN UNNECESSARY (decision-48 §2.2).
-- A preference records what somebody once INTENDED; this records what was actually tried
-- and what came back. The moment both exist, the column is a worse copy of this table and
-- disagrees with it the first time an admin presses the other button.
--
-- APPEND-ONLY BY CONVENTION: no route in this tree UPDATEs or DELETEs a row here. There is
-- deliberately no `delivered_at` — Twilio answers `queued`/`accepted` at creation, which is
-- "we have it", not "she has it", and delivery receipts need a public webhook route with a
-- signature check (§5.5, §11). The panel therefore says „übergeben", never „zugestellt".
--
-- WHAT IS NEVER IN HERE: the message body, the enrolment code, the OTP, any Twilio
-- credential. `provider_sid` is the SM… message id and `provider_code` is Twilio's public
-- numeric error class (21211 invalid To, 21610 unsubscribed, …) — both are REFERENCES, not
-- content. lib/scrub.js already drops a bare `code` key from every event.
-- ===========================================================================
CREATE TABLE sms_deliveries (
  id            BIGSERIAL PRIMARY KEY,

  -- 'enrolment_code' — the admin pressed „SMS senden" and we delivered the SAME decision-26
  -- code the „Zugangscode erzeugen" button mints. 'otp' — a worker asked for a sign-in code.
  kind          TEXT NOT NULL CHECK (kind IN ('enrolment_code', 'otp')),

  -- WHO it was for. Both NULLable and both ON DELETE SET NULL, for the reason 004 gives for
  -- enrolment_code_issued_by: "we texted someone who is no longer here" is still a fact, and
  -- a person leaving must not rewrite the record of what was sent.
  worker_id     BIGINT REFERENCES workers(id)   ON DELETE SET NULL,
  operator_id   BIGINT REFERENCES operators(id) ON DELETE SET NULL,

  -- The canonical number as it was handed to the carrier. Same CHECK as
  -- phone_identities.phone_e164 (007) so a row here can never record a shape that could not
  -- have been an identity — but deliberately NOT a foreign key: releasing or re-pointing a
  -- phone claim must not delete the record of what was already sent to that number.
  phone_e164    TEXT NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),

  -- TWO VALUES ONLY. There is no 'not_configured' and no 'queued'.
  --   'not_configured' — when the flag is off the route answers 503 BEFORE anything is
  --      minted or written, so a row here would be a delivery record for a non-delivery.
  --   'queued' — indistinguishable from 'sent' without receipts we do not collect.
  -- 'sent' means TWILIO ACCEPTED IT, which is not 'arrived' (§5.5).
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),

  -- failed only, and from a FIXED vocabulary built in lib/sms.js: timeout | network |
  -- network:<errno> | rejected | http_<n> | not_configured | malformed_response. Never a
  -- URL, never a Twilio response body, never an auth header — the same discipline
  -- lib/geocode.js's reason() applies to a Google URL that carries a key.
  reason        TEXT,

  provider_sid  TEXT,     -- sent only: the SM… message id, so a bill line can be traced
  provider_code INTEGER,  -- failed only, when Twilio named one

  -- WHICH admin pressed the button. NULL for /auth/sms/request, which no admin initiates.
  requested_by  BIGINT REFERENCES admins(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "What have we sent this worker, and when" — the cell on the workers screen. Partial, so
-- it stays the size of the question rather than the size of the table, exactly like
-- reported_tags_unresolved_idx (008) and zones_unverified_idx (010).
CREATE INDEX sms_deliveries_worker_idx ON sms_deliveries (worker_id, created_at DESC)
  WHERE worker_id IS NOT NULL;

-- "What did this system send today" — the spend question, and the only one that has to be
-- answerable across both kinds of recipient at once.
CREATE INDEX sms_deliveries_created_idx ON sms_deliveries (created_at DESC);
