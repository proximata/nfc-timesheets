-- 009_phone_pending.sql — WHAT A PHONE IS STILL HOLDING, so the office can see it.
--
-- THE SHAPE OF THE PROBLEM (TASK-225). A cleaner taps in at a door in a basement with no
-- signal. The row is written on the phone, correctly, and — until the Android build that
-- ships with this migration — was pushed only when a human happened to open the app. The
-- delivery half of that is a background job on the phone and needs no schema at all.
--
-- The half that DOES need schema is the question the office cannot otherwise ask:
--
--     "Anna has filed nothing since Tuesday. Is she off sick, or is her phone holding
--      three shifts in a basement?"
--
-- Those two have opposite answers and, before this file, produced identical evidence:
-- no rows. At one worker in one building that is a rounding error somebody notices. At
-- twenty cleaners across eight buildings it is a payroll that is quietly short every
-- month and an argument at month end, which is the most expensive place to discover it.
--
-- WHERE IT LIVES, AND WHY NOT worker_sessions. The obvious home is the session row — it
-- is per-device and it already exists. It is the wrong one: a session is DELETED on
-- logout and swept on expiry, so the fact would evaporate at exactly the moment it
-- becomes most interesting (a worker who signed out with three shifts queued still has
-- three shifts queued; the rows are not deleted on the phone either, deliberately). On
-- `workers` the fact survives the session, survives a re-enrolment onto a new handset,
-- and is one join fewer for every screen that wants it.
--
-- ONE PHONE PER WORKER IS ASSUMED, and this is the ceiling: a worker carrying two
-- handsets overwrites their own counts with whichever called last. That is the shape of
-- the operation today (decision-26 issues one enrolment code per worker) and the failure
-- mode is a wrong count, never a lost shift — the shifts themselves are on the phones and
-- are idempotent on client_uuid. UPGRADE PATH: a `phones` table keyed by an installation
-- id, the day a worker actually carries two.
--
-- HOW IT IS FILLED: three request HEADERS the Android app already attaches to every call
-- it makes (X-Pending-Shifts / X-Pending-Blocked / X-Pending-Oldest, net/Api.kt), recorded
-- fire-and-forget in server.js. No new endpoint, no extra round trip, nothing new on the
-- clock-in path — and an OLDER server simply ignores headers it does not know, which is
-- what makes an app newer than its box degrade to today's behaviour instead of failing.
--
-- ZERO ROWS ARE CREATED HERE and no existing value is invented: every column is NULLable
-- or defaults to a count of zero that means "this phone has never told us anything",
-- which is exactly what is true of every row the moment this file runs.
--
-- ADDITIVE ONLY, no BEGIN/COMMIT (migrate.js already runs each file with `psql -1`).

-- The last moment ANY request arrived carrying this worker's session. This is the column
-- STATE-OF-THE-PRODUCT §5 named as missing, and it is the one that separates "absent"
-- from "phone in a pocket": it is written on every authenticated call, including calls
-- that carry no pending headers at all (an iOS client, say), because "we heard from this
-- phone" is a fact independent of what it had to say.
ALTER TABLE workers ADD COLUMN phone_last_seen_at TIMESTAMPTZ;

-- How many shifts the phone said it was still holding AND still expects to deliver on its
-- own. NOT NULL DEFAULT 0 rather than NULLable: a screen that has to distinguish "zero
-- pending" from "never reported" reads phone_last_seen_at, which is the column that
-- actually carries that distinction. Two columns encoding the same unknown is how they
-- drift.
ALTER TABLE workers ADD COLUMN phone_pending_shifts INTEGER NOT NULL DEFAULT 0;

-- Shifts the phone has GIVEN UP on: queued under a different account, or a location the
-- server refuses. Counted separately for the same reason the app shows them separately —
-- "wait for signal" and "somebody must act" are opposite instructions, and a single total
-- would let a permanently stuck shift hide inside a number that looks like it is moving.
ALTER TABLE workers ADD COLUMN phone_pending_blocked INTEGER NOT NULL DEFAULT 0;

-- The start time of the OLDEST undelivered shift on that phone. This is the number that
-- turns into money: it says how long ago work the server has never heard of was actually
-- done, which is what decides whether it will land inside this month's payroll or after
-- it has been paid.
ALTER TABLE workers ADD COLUMN phone_pending_oldest_start TIMESTAMPTZ;

-- "Which phones are holding work" — the one read the admin panel does with these columns.
-- Partial, so it stays the size of the problem (nearly always zero rows) rather than the
-- size of the payroll.
CREATE INDEX workers_phone_pending_idx ON workers (phone_pending_shifts)
  WHERE phone_pending_shifts > 0 OR phone_pending_blocked > 0;
