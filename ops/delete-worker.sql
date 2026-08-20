-- ops/delete-worker.sql — delete ONE named worker and everything that hangs off them.
--
-- WHY THIS EXISTS AND ops/reset-w1.sql DOES NOT DO IT. reset-w1 is the owner's whole-board
-- wipe: it takes `locations` with it, and locations is where HOIV lives — the client's only
-- building, the one whose UUID is written on a card screwed to a wall. This file is the
-- surgical version: one worker, named on the command line, with the building untouched.
--
-- THE ROW IT WAS WRITTEN FOR: production `workers` id 6, 'TTL Test', hourly_rate_cents 0,
-- already inactive, holding an unredeemed enrolment code that expires 2026-08-22. Migration
-- 006 REFUSES to apply while it exists (decision-41: a migration does not get to choose
-- somebody's wage), so it is the last thing standing between this repo and a deploy. Removal
-- authorised by the owner, enrolment code included.
--
-- Run with psql DIRECTLY, NOT via server/db/migrate.js: this is DML on operational data, not
-- a schema migration, so it is allowed its own BEGIN/COMMIT (the "no BEGIN/COMMIT" house rule
-- applies only to files under server/db/migrations/).
--
-- USAGE — all four -v flags are REQUIRED and none has a default:
--
--   ssh schimmer-glanz.exe.xyz
--   sudo -u postgres /srv/nfc/ops/backup/pg-backup.sh        # 1 · take the backup
--   sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 \        # 2 · run this, naming both
--        -v confirm_database=nfc \
--        -v worker_id=6 \
--        -v verified_backup=/var/backups/nfc/nfc-<the one you just took>.sql.gz \
--        -f /srv/nfc/ops/delete-worker.sql
--
-- REHEARSE IT FIRST, against a restored dump in a scratch database:
--   node ops/check-delete-worker.mjs /tmp/nfc-prod.sql.gz
-- That harness is the thing that has to pass. A reading of this file is not a rehearsal.
--
-- NOT IDEMPOTENT, ON PURPOSE. A second run refuses with "worker N does not exist", because
-- the far likelier cause of a missing id is a TYPO than a repeat, and quietly succeeding on
-- a mistyped id is how the wrong person gets deleted next time.
--
-- ===========================================================================
-- 0 · REFUSE TO RUN AGAINST A DATABASE THIS WAS NOT EXPLICITLY TOLD TO TARGET.
--     Same guard, same wording and the same reasoning as ops/reset-w1.sql §0: the one
--     mistake a correctly-written DELETE list cannot catch is being pointed at the wrong
--     database, by a $DATABASE_URL a shell forgot to unset or a terminal tab left on
--     production. Every refusal below is a real SQL error (RAISE EXCEPTION), never a psql
--     meta-command, so it forces a nonzero exit for a caller checking $? — this psql build
--     ignores the argument to `\quit` and exits 0, which is the wrong answer for a refusal.
-- ===========================================================================
\set ON_ERROR_STOP on

\if :{?confirm_database}
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: pass -v confirm_database=<database name>, naming EXACTLY the database you mean '
    'to write to. This script refuses to guess.';
  END $$;
\endif

\if :{?worker_id}
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: pass -v worker_id=<id>. There is no default and there is no "the obvious one".';
  END $$;
\endif

-- THE BACKUP GATE IS REAL, NOT A PROMISE. reset-w1.sql delegates "take a backup first" to
-- its runbook, where it is a sentence a hurried operator skips. Here the file is STAT'd by
-- the server: it must exist, be non-trivial, and be RECENT. pg_stat_file() reads the
-- database server's own filesystem, which is exactly where pg-backup.sh writes, and it needs
-- superuser (or pg_read_server_files) — which the documented invocation has, because it runs
-- as the `postgres` role, the same role pg-backup.sh runs as. If it does not, this raises and
-- nothing is deleted: the gate fails CLOSED.
\if :{?verified_backup}
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: pass -v verified_backup=/var/backups/nfc/nfc-<ts>.sql.gz — the dump you took '
    'MOMENTS AGO. It is stat''d, not trusted: it must exist, be >=200 bytes and be less '
    'than 6 hours old. Take one first: sudo -u postgres /srv/nfc/ops/backup/pg-backup.sh';
  END $$;
\endif

SELECT current_database() = :'confirm_database' AS db_confirmed \gset
\if :db_confirmed
\else
  DO $$ BEGIN RAISE EXCEPTION
    'FATAL: -v confirm_database does not match the database this connection is actually on. '
    'Refusing — pass the RIGHT name, or you are one flag away from deleting from the wrong box.';
  END $$;
\endif
\echo 'confirmed: targeting database' :confirm_database

BEGIN;

-- Visible to the DO blocks below without re-deriving psql-variable interpolation inside a
-- dollar-quoted body — psql substitutes `:name` tokens as raw text, dollar-quoting included,
-- which is a hazard the moment a value contains something that reads as SQL. SET LOCAL is
-- transaction-scoped: it never outlives this COMMIT/ROLLBACK.
SET LOCAL delete_worker.worker_id      = :'worker_id';
SET LOCAL delete_worker.verified_backup = :'verified_backup';

-- ===========================================================================
-- 1 · PRE-FLIGHT. Every one of these RAISEs, which aborts the transaction before a single
--     row is touched.
-- ===========================================================================

-- 1a · the backup must exist, be real, and be recent.
DO $$
DECLARE p text := current_setting('delete_worker.verified_backup');
        st record;
BEGIN
  BEGIN
    SELECT size, modification INTO st FROM pg_stat_file(p);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'refusing to delete: cannot stat the backup % (%). The gate fails '
      'CLOSED — either the path is wrong, or this connection is not superuser and cannot '
      'read the server filesystem. Run as: sudo -u postgres psql -d nfc ...', p, SQLERRM;
  END;
  IF st.size < 200 THEN
    RAISE EXCEPTION 'refusing to delete: % is only % bytes. A valid gzipped dump of even an '
      'empty schema is larger than that; this one is truncated or empty.', p, st.size;
  END IF;
  IF st.modification < now() - interval '6 hours' THEN
    RAISE EXCEPTION 'refusing to delete: % was written at % — more than 6 hours ago. Take a '
      'FRESH one (sudo -u postgres /srv/nfc/ops/backup/pg-backup.sh) and name that. A stale '
      'dump restores a database that never contained the mistake you are about to make.',
      p, st.modification;
  END IF;
  RAISE NOTICE 'backup gate: % (% bytes, written %)', p, st.size, st.modification;
END $$;

-- 1b · EVERY TABLE WITH A FOREIGN KEY TO workers MUST BE ONE THIS FILE KNOWS ABOUT.
--
--     This is the assertion that keeps the DELETE list below honest a year from now. The
--     list is hand-written and ordered; a migration that adds a new child of `workers`
--     would leave it silently incomplete, and the failure mode is a 23503 mid-transaction
--     at best and a missed row at worst. So the graph is read from the catalogue at run
--     time and compared against what is written here. An unknown child ABORTS and names
--     itself, rather than being skipped.
--
--     `phone_identities` (007) is listed as KNOWN but is not required to exist: this script
--     is meant to run BEFORE 006/007 land (decision-46 §2 makes the same argument for the
--     W1 reset), and it must also be correct if it is run after.
DO $$
DECLARE unknown text;
BEGIN
  SELECT string_agg(DISTINCT c.conrelid::regclass::text, ', ' ORDER BY c.conrelid::regclass::text)
    INTO unknown
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid = 'workers'::regclass
     AND c.conrelid::regclass::text <> ALL (ARRAY[
           'worker_sessions',      -- 002, ON DELETE CASCADE (deleted explicitly anyway)
           'material_requests',    -- 003, NO ACTION, worker_id NOT NULL
           'shifts',               -- 001, NO ACTION, worker_id NOT NULL
           'phone_identities'      -- 007, ON DELETE SET NULL — see §2 below
         ]);
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to delete: table(s) % reference workers and this script has '
      'never heard of them. A migration added a child after this file was written. Add them '
      'to the ordered DELETE list in §2 — and to this array — before running it.', unknown;
  END IF;
END $$;

-- 1c · the worker must exist. A typo'd id is a refusal, not a silent no-op.
DO $$
DECLARE w record;
BEGIN
  SELECT id, name, hourly_rate_cents, active,
         (enrolment_code_hash IS NOT NULL) AS has_code, enrolment_code_expires_at
    INTO w
    FROM workers WHERE id = current_setting('delete_worker.worker_id')::bigint;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refusing to delete: no worker with id %. Check the id — this script is '
      'deliberately NOT idempotent, because a missing id is far more often a typo than a '
      'repeat run.', current_setting('delete_worker.worker_id');
  END IF;
  RAISE NOTICE 'target: worker id % · % · rate % · active % · live enrolment code %',
    w.id, w.name, w.hourly_rate_cents, w.active,
    CASE WHEN w.has_code AND w.enrolment_code_expires_at > now()
         THEN 'YES, expires ' || w.enrolment_code_expires_at
         ELSE 'no' END;
END $$;

-- ===========================================================================
-- 2 · BEFORE — snapshotted into a temp table so §3's assertions can compare against it
--     INSIDE THE SAME TRANSACTION. A count printed to a terminal proves nothing to the
--     transaction that is about to commit.
-- ===========================================================================
-- The `_others` columns are the load-bearing ones: a total alone would be satisfied by a
-- run that deleted the WRONG worker's shifts and the RIGHT worker's row.
CREATE TEMP TABLE delete_worker_before ON COMMIT DROP AS
SELECT (SELECT count(*) FROM workers)   AS workers_total,
       (SELECT count(*) FROM locations) AS locations_total,
       (SELECT count(*) FROM admins)    AS admins_total,
       (SELECT count(*) FROM shifts            WHERE worker_id <> current_setting('delete_worker.worker_id')::bigint) AS shifts_others,
       (SELECT count(*) FROM material_requests WHERE worker_id <> current_setting('delete_worker.worker_id')::bigint) AS materials_others,
       (SELECT count(*) FROM worker_sessions   WHERE worker_id <> current_setting('delete_worker.worker_id')::bigint) AS sessions_others;

\echo 'BEFORE (rows belonging to the target worker):'
SELECT 'worker_sessions'   AS t, count(*) FROM worker_sessions   WHERE worker_id = current_setting('delete_worker.worker_id')::bigint
UNION ALL SELECT 'material_requests', count(*) FROM material_requests WHERE worker_id = current_setting('delete_worker.worker_id')::bigint
UNION ALL SELECT 'shifts',            count(*) FROM shifts            WHERE worker_id = current_setting('delete_worker.worker_id')::bigint
UNION ALL SELECT 'workers (the row)', count(*) FROM workers           WHERE id        = current_setting('delete_worker.worker_id')::bigint;

-- ===========================================================================
-- 3 · ORDERED DELETE, deepest dependent first, all in the one transaction opened above.
--
--     ORDER IS THE WHOLE POINT and it is not alphabetical: shifts.worker_id and
--     material_requests.worker_id are both NOT NULL with NO ACTION, so deleting the worker
--     first raises 23503 and takes the whole transaction with it. worker_sessions is
--     ON DELETE CASCADE and would go by itself; it is deleted explicitly anyway, for the
--     same reason reset-w1.sql gives — a reviewer should not have to reconstruct the FK
--     graph to audit a script that destroys somebody's payroll history.
--
--     A DELETED WORKER TAKES THEIR SHIFTS AND MATERIAL REQUESTS WITH THEM. There is no
--     orphan reading of either (both columns are NOT NULL), so "keep the history, drop the
--     person" is not expressible in this schema. For the row this was written for that is
--     free — id 6 has zero of both — but it is the reason this script is for LEFTOVERS and
--     never for a real cleaner who has been paid for work. Deactivate those instead.
-- ===========================================================================
DELETE FROM worker_sessions   WHERE worker_id = current_setting('delete_worker.worker_id')::bigint;
DELETE FROM material_requests WHERE worker_id = current_setting('delete_worker.worker_id')::bigint;
DELETE FROM shifts            WHERE worker_id = current_setting('delete_worker.worker_id')::bigint;

-- 007's phone_identities, if it has landed. worker_id is ON DELETE SET NULL, and the table
-- carries CHECK phone_identities_claims (at least one of worker_id / operator_id set). A row
-- that claims ONLY this worker would be driven to (NULL, NULL) as part of the DELETE FROM
-- workers statement itself and violate that CHECK immediately — CHECK constraints are
-- per-row-immediate, never deferred. So detach explicitly, and in this order: delete the
-- worker-ONLY rows outright first (never UPDATE them to worker_id = NULL, which hits the
-- same CHECK one statement earlier), then clear worker_id on the rows that also claim an
-- operator, which therefore survive still claiming somebody. Same fix, same reasoning, as
-- ops/reset-w1.sql §4 — that one found it.
DO $$ BEGIN
  IF to_regclass('public.phone_identities') IS NOT NULL THEN
    EXECUTE 'DELETE FROM phone_identities WHERE worker_id = $1 AND operator_id IS NULL'
      USING current_setting('delete_worker.worker_id')::bigint;
    EXECUTE 'UPDATE phone_identities SET worker_id = NULL WHERE worker_id = $1'
      USING current_setting('delete_worker.worker_id')::bigint;
  END IF;
END $$;

DELETE FROM workers WHERE id = current_setting('delete_worker.worker_id')::bigint;

-- ===========================================================================
-- 4 · THE ASSERTIONS THAT MATTER, inside the transaction, so a failure ROLLS BACK rather
--     than committing damage. "It ran" is not the claim; "it removed exactly one worker and
--     touched nothing else" is.
-- ===========================================================================
DO $$
DECLARE b record; wid bigint := current_setting('delete_worker.worker_id')::bigint;
        n bigint;
BEGIN
  SELECT * INTO b FROM delete_worker_before;

  IF EXISTS (SELECT 1 FROM workers WHERE id = wid) THEN
    RAISE EXCEPTION 'ABORT: worker % is still there after the DELETE. Rolling back.', wid;
  END IF;

  SELECT count(*) INTO n FROM workers;
  IF n <> b.workers_total - 1 THEN
    RAISE EXCEPTION 'ABORT: workers went from % to % — this script deletes EXACTLY ONE. '
      'Rolling back.', b.workers_total, n;
  END IF;

  -- HOIV LIVES HERE. A cascade or a copy-paste error that reached `locations` would delete
  -- the building whose UUID is on a card screwed to a wall in Arsenalstrasse, and no site
  -- visit fixes that. Same standing as reset-w1.sql's admins assertion.
  SELECT count(*) INTO n FROM locations;
  IF n <> b.locations_total THEN
    RAISE EXCEPTION 'ABORT: locations went from % to %. A building was destroyed by a '
      'worker deletion. Rolling back.', b.locations_total, n;
  END IF;

  SELECT count(*) INTO n FROM admins;
  IF n <> b.admins_total THEN
    RAISE EXCEPTION 'ABORT: admins went from % to % — the owner would be locked out of his '
      'own panel. Rolling back.', b.admins_total, n;
  END IF;

  -- NOTHING BELONGING TO ANYBODY ELSE MOVED. Every other worker's dependent rows are
  -- counted before and after; an unqualified `DELETE FROM shifts` passes every count above
  -- and dies here.
  SELECT count(*) INTO n FROM shifts WHERE worker_id <> wid;
  IF n <> b.shifts_others THEN
    RAISE EXCEPTION 'ABORT: other workers'' shifts went from % to %. This deletes ONE '
      'worker''s rows and nobody else''s. Rolling back.', b.shifts_others, n;
  END IF;

  SELECT count(*) INTO n FROM material_requests WHERE worker_id <> wid;
  IF n <> b.materials_others THEN
    RAISE EXCEPTION 'ABORT: other workers'' material_requests went from % to %. Rolling '
      'back.', b.materials_others, n;
  END IF;

  SELECT count(*) INTO n FROM worker_sessions WHERE worker_id <> wid;
  IF n <> b.sessions_others THEN
    RAISE EXCEPTION 'ABORT: other workers'' sessions went from % to % — everybody else was '
      'logged out of the app. Rolling back.', b.sessions_others, n;
  END IF;
END $$;

-- The "nobody else lost anything" assertion, written out rather than folded into the block
-- above, because it needs the BEFORE counts of OTHER workers' rows and those must be read
-- the same way twice. Any row left anywhere pointing at the deleted id is a hard abort.
DO $$
DECLARE wid bigint := current_setting('delete_worker.worker_id')::bigint;
        r record; n bigint;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS child, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f' AND c.confrelid = 'workers'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.child, r.col) INTO n USING wid;
    IF n > 0 THEN
      RAISE EXCEPTION 'ABORT: % rows still in %.% point at the deleted worker %. Rolling '
        'back.', n, r.child, r.col, wid;
    END IF;
  END LOOP;
END $$;

\echo 'AFTER:'
SELECT 'workers'   AS t, count(*) FROM workers
UNION ALL SELECT 'locations', count(*) FROM locations
UNION ALL SELECT 'admins',    count(*) FROM admins
UNION ALL SELECT 'shifts',    count(*) FROM shifts;

-- And the one thing this was all for: 006's guard, evaluated here rather than discovered
-- mid-deploy. It is a NOTICE and not a RAISE — another rate-less worker is somebody else's
-- row and not this invocation's business, but the operator should read it before leaving.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workers WHERE hourly_rate_cents <= 0;
  IF n = 0 THEN
    RAISE NOTICE '006 rate guard: 0 rate-less workers remain — migration 006 will apply.';
  ELSE
    RAISE NOTICE '006 rate guard: % rate-less worker(s) STILL remain — 006 will still '
      'refuse. Deal with them too.', n;
  END IF;
END $$;

COMMIT;
\echo 'delete-worker: done.'
