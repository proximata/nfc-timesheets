-- ops/reset-w1.sql — the owner's W1 wipe. TASK-213, decision-46.
--
-- Owner, verbatim: "Wipe everything: workers, locations, buildings, shifts, tags, portal
-- links. Keep one admin so you are not locked out of your own panel while doing it."
--
-- Run with psql DIRECTLY, NOT via server/db/migrate.js: this is DML on operational data,
-- not a schema migration, so it is allowed its own BEGIN/COMMIT (the "no BEGIN/COMMIT"
-- house rule applies only to files under server/db/migrations/, where migrate.js already
-- wraps each file in `psql -1`).
--
--   1. TAKE A BACKUP FIRST, AND VERIFY THE RESTORE — not optional, not this file's job:
--        sudo -u postgres /srv/nfc/ops/backup/pg-backup.sh
--        sudo -u postgres /srv/nfc/ops/backup/restore-test.sh
--      (decision-46 §4 — reuses the already-deployed mechanism, no new backup tooling.)
--
--   2. Rehearse against a RESTORED DUMP in a scratch database. Never trust this file
--      against a database that has never seen it before — ops/check-reset-w1.mjs is that
--      rehearsal harness, and it is the thing that has to pass, not a reading of this file.
--
--   3. Run it, naming the database explicitly on the command line — see USAGE below.
--
-- USAGE (both -v flags are REQUIRED; there is no default for either):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v confirm_database=nfc \
--        -f ops/reset-w1.sql
--
--   ...and if a worker holds a LIVE, unredeemed enrolment code (checked below), add:
--        -v allow_live_code_loss=1
--
-- SAFE TO RUN TWICE. The second run finds every target table already empty: the
-- pre-flight guards still pass (no live code left to lose, the one admin is still
-- there), the DELETEs each remove 0 rows, and the final assertion still holds.
--
-- ===========================================================================
-- 0 · REFUSE TO RUN AGAINST A DATABASE THIS WAS NOT EXPLICITLY TOLD TO TARGET.
--
-- Not in OPERATOR-MODEL.md §10's sketch — added here because the brief for this task
-- names it directly ("REFUSES to run against any database it was not explicitly told to
-- target. Show it refusing.") and it is cheap insurance against the one mistake a
-- correctly-written DELETE list cannot catch: `$DATABASE_URL` pointing at the wrong box
-- because a shell forgot to `unset` it, or a terminal tab was left on production. A typo'd
-- -v confirm_database is a refusal; a MATCHING one still requires the operator to have
-- typed the name out loud, which is the entire point.
-- ===========================================================================
-- ON_ERROR_STOP FIRST, before any check below — every refusal in this section is a real
-- SQL error (RAISE EXCEPTION), not a psql meta-command, precisely so it forces a nonzero
-- exit code for a caller checking $? — this psql build has no `\quit <code>` (checked: it
-- silently ignores the argument and exits 0, which is the WRONG answer for a refusal a
-- script has to be able to detect).
\set ON_ERROR_STOP on

\if :{?confirm_database}
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: pass -v confirm_database=<database name>, naming EXACTLY the database you '
    'mean to wipe. This script refuses to guess. Example: '
    'psql "$DATABASE_URL" -v confirm_database=nfc -f ops/reset-w1.sql';
  END $$;
\endif

SELECT current_database() = :'confirm_database' AS db_confirmed \gset
\if :db_confirmed
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: -v confirm_database does not match the database this connection is actually '
    'on. Refusing — pass the RIGHT name, or you are one flag away from wiping the wrong box.';
  END $$;
\endif
\echo 'confirmed: targeting database' :confirm_database

-- A live enrolment code is a hard stop by default (decision-46 §3). `allow_live_code_loss`
-- has no default value baked in here on purpose — \if :{?...} below reads "was it passed
-- at all", so an operator who never typed the flag gets the refusal, not a silent 0.
\if :{?allow_live_code_loss}
\else
  \set allow_live_code_loss 0
\endif

BEGIN;

-- Visible to the DO blocks below without re-deriving psql-variable interpolation inside a
-- dollar-quoted body (fragile — psql substitutes `:name` tokens as raw text, dollar-quoting
-- included, which is a hazard the moment a value contains something that reads as SQL).
-- SET LOCAL is transaction-scoped: it never outlives this COMMIT/ROLLBACK, matching the
-- lifetime of everything else this script touches.
SET LOCAL reset_w1.allow_live_code_loss = :'allow_live_code_loss';

-- ===========================================================================
-- 1 · PRE-FLIGHT (decision-46 §3, §6). Both RAISE, which aborts the transaction before a
--     single row is touched — psql's `-v ON_ERROR_STOP=1` (set above) then exits nonzero.
-- ===========================================================================
DO $$
DECLARE n_admins int; n_live_codes int;
BEGIN
  SELECT count(*) INTO n_admins FROM admins;
  IF n_admins < 1 THEN
    RAISE EXCEPTION 'refusing to reset: 0 admin rows exist NOW, before this script runs '
      '— the lockout this script exists to avoid is already true. Fix that first.';
  END IF;

  SELECT count(*) INTO n_live_codes FROM workers
   WHERE enrolment_code_hash IS NOT NULL AND enrolment_code_expires_at > now();
  IF n_live_codes > 0 AND current_setting('reset_w1.allow_live_code_loss', true) <> '1' THEN
    RAISE EXCEPTION '% worker(s) hold a LIVE, unredeemed enrolment code. Wiping them '
      'destroys an in-progress enrolment a real person may be about to complete. '
      'Re-run with -v allow_live_code_loss=1 (a psql variable, not a default) once that '
      'is a deliberate choice, not an oversight.', n_live_codes;
  END IF;
END $$;

-- ===========================================================================
-- 2 · BEFORE — printed, the only record of what this destroyed besides the backup taken
--     in step 0 of the runbook above. Guarded with to_regclass so this ONE file runs
--     correctly whether or not 006 (zones, location_revenue) or 007 (phone_identities,
--     operators, operator_sessions) has landed yet — decision-46 §2 recommends running
--     this BEFORE either does, but nothing here assumes that ordering was followed.
-- ===========================================================================
\echo 'BEFORE:'
SELECT 'worker_sessions'    AS t, count(*) FROM worker_sessions
UNION ALL SELECT 'material_requests', count(*) FROM material_requests
UNION ALL SELECT 'shifts', count(*) FROM shifts
UNION ALL SELECT 'portal_grants', count(*) FROM portal_grants
UNION ALL SELECT 'location_contracts', count(*) FROM location_contracts
UNION ALL SELECT 'workers', count(*) FROM workers
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'admins (must be unchanged after)', count(*) FROM admins;

DO $$
BEGIN
  IF to_regclass('public.zones') IS NOT NULL THEN
    RAISE NOTICE 'zones: %', (SELECT count(*) FROM zones);
  END IF;
  IF to_regclass('public.location_revenue') IS NOT NULL THEN
    RAISE NOTICE 'location_revenue: %', (SELECT count(*) FROM location_revenue);
  END IF;
  IF to_regclass('public.phone_identities') IS NOT NULL THEN
    RAISE NOTICE 'phone_identities: % (operators table itself is NOT reset — see §5 below)',
      (SELECT count(*) FROM phone_identities);
  END IF;
END $$;

-- ===========================================================================
-- 3 · ORDERED DELETE, deepest dependents first. Explicit statements, not
--     `TRUNCATE ... CASCADE`, even though both reach the identical table set (cross-check
--     query below) — a reviewer reading nine explicit statements does not have to
--     reconstruct the FK graph first, on a script that deletes a client's real data
--     (decision-46 §5).
--
--     cross-check, run once before trusting this list and again if a migration adds a new
--     table referencing workers or locations:
--       SELECT conrelid::regclass FROM pg_constraint
--        WHERE confrelid IN ('workers'::regclass, 'locations'::regclass) AND contype = 'f';
--       -- must equal exactly: worker_sessions, material_requests, shifts (x2 columns, one
--       -- table), location_contracts, portal_grants, (006:) location_revenue, zones,
--       -- (007:) phone_identities
-- ===========================================================================
DELETE FROM worker_sessions;        -- would cascade anyway (ON DELETE CASCADE); explicit
                                     -- for auditability, same reasoning decision-46 gives
DELETE FROM material_requests;      -- forced: worker_id NOT NULL, no orphan reading exists
DELETE FROM shifts;                 -- named ("shifts")
DELETE FROM portal_grants;          -- named ("portal links")

DO $$ BEGIN
  IF to_regclass('public.location_revenue') IS NOT NULL THEN
    EXECUTE 'DELETE FROM location_revenue';                     -- 006 only, forced
  END IF;
  IF to_regclass('public.zones') IS NOT NULL THEN
    EXECUTE 'DELETE FROM zones';                                -- 006 only, named ("tags")
  END IF;
END $$;

DELETE FROM location_contracts;     -- forced: location_id NOT NULL, no cascade

-- ---------------------------------------------------------------------------
-- 4 · THE 007 FIX — found walking the FK graph 007_operator_identity.sql introduces,
--     not present in OPERATOR-MODEL.md §10's original sketch (decision-46 predates 007).
--
--     phone_identities.worker_id REFERENCES workers(id) ON DELETE SET NULL. A
--     phone_identities row that carries ONLY worker_id (a pure cleaner, no operator link
--     — operator_id already NULL) has that row driven to (NULL, NULL) the INSTANT
--     `DELETE FROM workers` fires, as PART OF THE SAME STATEMENT's FK action. CHECK
--     constraints are validated synchronously per row, not deferred, so that (NULL, NULL)
--     row immediately violates phone_identities_claims and the DELETE FROM workers
--     statement ABORTS — the first time any pure-worker phone identity exists at all.
--     (Proven at the schema level, RED-then-GREEN, in server/db/check-migrate.js's 007
--     spot-checks — this is the same fact, worked around here rather than discovered here.)
--
--     FIX: detach explicitly, first, then drop what decays to nothing — and note the
--     ORDER inside the fix itself matters just as much (see the code comment right above
--     the DO block below): a worker-only row is DELETED directly, never UPDATEd to
--     worker_id = NULL first, because that UPDATE would itself produce a (NULL, NULL) row
--     and hit the SAME CHECK one statement earlier.
--       - a row with ONLY worker_id set -> deleted outright (it now claims nobody).
--       - a row with BOTH worker_id AND operator_id set (the owner-cleans-a-building case,
--         §3) has worker_id cleared but SURVIVES, still claiming operator_id — correct:
--         operators are not on the owner's reset list and this is not what deletes them.
-- ---------------------------------------------------------------------------
-- ORDER WITHIN THE FIX MATTERS: delete the worker-ONLY rows FIRST, directly — never via
-- an UPDATE that sets worker_id = NULL on them, because THAT UPDATE would itself drive the
-- row to (NULL, NULL) and violate phone_identities_claims immediately (CHECK constraints
-- are per-row-immediate, not deferred, so this is not merely the earlier DELETE FROM
-- workers problem restated — it recurs one statement earlier if written the naive way).
-- Only AFTER those are gone does the UPDATE run, and by then every remaining worker_id-
-- holding row also holds operator_id (the owner-cleans-a-building case), so clearing
-- worker_id there always leaves a row that still claims operator_id — never (NULL, NULL).
DO $$ BEGIN
  IF to_regclass('public.phone_identities') IS NOT NULL THEN
    EXECUTE 'DELETE FROM phone_identities WHERE worker_id IS NOT NULL AND operator_id IS NULL';
    EXECUTE 'UPDATE phone_identities SET worker_id = NULL WHERE worker_id IS NOT NULL';
  END IF;
END $$;

DELETE FROM workers;                -- named. Takes id 6, 'TTL Test', rate 0, with it — for
                                     -- free, IF this runs before 006 lands (decision-46 §2).
DELETE FROM locations;              -- named ("buildings")

-- operators, operator_sessions: UNTOUCHED, on purpose. Never named in the owner's list,
-- never forced by a cascade from anything above (operator_sessions -> operators is
-- ON DELETE CASCADE, but operators itself is never named or forced by this DELETE set),
-- and the owner's reset instruction predates operators existing at all. A deliberate
-- omission, not a gap — decision-46 says so, and nothing here overturns it.
--
-- "recreates the operator" (this task's brief) is read here as keeping ADMINISTRATIVE
-- ACCESS intact — the one `admins` row this script never touches and asserts survives
-- below — not as inserting a fresh `operators` row. Fabricating one would need a name and
-- a phone number nobody supplied, which is exactly the kind of invented fact this
-- project's own convention refuses (006's own rate guard: "a migration does not get to
-- choose somebody's wage" applies just as hard to choosing somebody's identity). If the
-- brief meant literally re-seeding an operator, that is a scope question for the owner,
-- not a guess this script makes silently.

-- ===========================================================================
-- 5 · THE ASSERTION THAT MATTERS: an admin swept up by a cascade or a copy-paste error
--     above rolls this transaction BACK rather than committing a lockout (decision-46 §6).
-- ===========================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM admins;
  IF n < 1 THEN
    RAISE EXCEPTION 'ABORT: admins table is now EMPTY. This transaction is being rolled '
      'back rather than committed — the owner would be locked out of his own panel.';
  END IF;
END $$;

\echo 'AFTER:'
SELECT 'workers' AS t, count(*) FROM workers
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'shifts', count(*) FROM shifts
UNION ALL SELECT 'admins', count(*) FROM admins;

COMMIT;
\echo 'reset-w1: done.'
