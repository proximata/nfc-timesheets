#!/usr/bin/env bash
#
# CHECK for ops/sql/autoclose.sql (TASK-11, decision-10, decision-19).
#
# Builds a scratch database from the REAL migration (server/db/migrations/001_init.sql —
# this file used to keep its own copy of the schema, which promptly drifted), inserts one
# shift that started 9h ago with end_time NULL, runs autoclose.sql TWICE and asserts:
#   run 1 -> exactly 1 row updated   (the safety net fires)
#   run 2 -> exactly 0 rows updated  (it is idempotent; no double-processing after a catch-up
#                                     run from Persistent=true, no bookkeeping table needed)
# Also asserts the closed shift is start+8h with auto_closed set and corrected_at still NULL
# (the timer is not a human — only worker resolution sets corrected_at), and that the
# partial UNIQUE index rejects a second concurrent open shift for one worker (double-punch).
#
# Never touches the live `nfc` database. Exits 0 with a SKIP if no Postgres is reachable, so
# it is safe to run on a laptop or in CI without a database.
#
#   ./ops/check-autoclose.sh

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
SQL="$here/sql/autoclose.sql"
SCHEMA="$here/../server/db/migrations/001_init.sql"
SCRATCH="nfc_autoclose_check_$$"
LOC="00000000-0000-0000-0000-0000000000aa"   # fixed so the fixtures can reference it

[ -f "$SQL" ]    || { echo "FATAL: $SQL not found" >&2; exit 1; }
[ -f "$SCHEMA" ] || { echo "FATAL: $SCHEMA not found" >&2; exit 1; }

# --- skip cleanly when there is no database to talk to ---
if ! command -v psql >/dev/null 2>&1 || ! command -v createdb >/dev/null 2>&1; then
  echo "SKIP: psql/createdb not on PATH — no database to check against"
  exit 0
fi
export PGCONNECT_TIMEOUT=3
if ! psql -At -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "SKIP: no reachable Postgres (cannot connect to maintenance db 'postgres')"
  exit 0
fi

cleanup() { dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb "$SCRATCH"
psql -q -v ON_ERROR_STOP=1 -d "$SCRATCH" -f "$SCHEMA"
psql -q -v ON_ERROR_STOP=1 -d "$SCRATCH" <<SQLFIXTURES
-- A rate is supplied even though this fixture is built from 001 only: 006 drops the
-- column's DEFAULT (decision-41), so the day this check is pointed at the full migration
-- set an omitted rate raises 23502. Cheaper to be right now than to debug it then.
INSERT INTO workers (id, name, hourly_rate_cents) VALUES (1, 'Check Worker One', 1500), (2, 'Check Worker Two', 1500);
INSERT INTO locations (id, slug, name) VALUES ('$LOC', 'check-loc', 'Check Location');
-- stale: worker 1, open, started 9h ago -> must be auto-closed
INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
VALUES (1, '$LOC', now() - INTERVAL '9 hours', 'check-stale');
-- fresh: worker 2, open, started 1h ago -> must be left alone.
-- Separate worker on purpose: one open shift per worker is now a hard constraint.
INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
VALUES (2, '$LOC', now() - INTERVAL '1 hour', 'check-fresh');
SQLFIXTURES

# psql prints the `UPDATE <n>` command tag on stdout; that is the row count.
rows() { psql -v ON_ERROR_STOP=1 -d "$SCRATCH" -f "$SQL" | grep -o '^UPDATE [0-9]*' | awk '{print $2}'; }

first="$(rows)"
second="$(rows)"

fail=0
[ "$first"  = "1" ] || { echo "FAIL: first run updated '$first' rows, expected 1" >&2; fail=1; }
[ "$second" = "0" ] || { echo "FAIL: second run updated '$second' rows, expected 0 (not idempotent)" >&2; fail=1; }

# decision-10: auto_closed says "the timer did this"; corrected_at stays NULL because no
# human has resolved it yet. That pair is exactly GET /shifts/unresolved's predicate.
state="$(psql -At -d "$SCRATCH" -c "
  select end_time = start_time + INTERVAL '8 hours' and auto_closed and corrected_at is null
    from shifts where client_uuid = 'check-stale'")"
[ "$state" = "t" ] || { echo "FAIL: stale shift not closed at start+8h with auto_closed set and corrected_at NULL" >&2; fail=1; }

untouched="$(psql -At -d "$SCRATCH" -c "
  select end_time is null and not auto_closed and corrected_at is null
    from shifts where client_uuid = 'check-fresh'")"
[ "$untouched" = "t" ] || { echo "FAIL: 1h-old open shift was modified — threshold is wrong" >&2; fail=1; }

# --- overlap guard: double-punch must not create two concurrent open shifts ---------
# Worker 2 still has an open shift, so a second open shift for worker 2 must be rejected
# by shifts_one_open_per_worker_idx (unique_violation, SQLSTATE 23505).
dup_err="$(psql -At -v ON_ERROR_STOP=1 -d "$SCRATCH" -c "
  INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
  VALUES (2, '$LOC', now(), 'check-double-punch')" 2>&1 >/dev/null)" && dup_err=""
if [ -z "$dup_err" ]; then
  echo "FAIL: second concurrent open shift for worker 2 was ACCEPTED — overlap guard missing" >&2
  fail=1
elif ! printf '%s' "$dup_err" | grep -qi 'duplicate key\|shifts_one_open_per_worker_idx'; then
  echo "FAIL: second open shift rejected, but not by the overlap guard: $dup_err" >&2
  fail=1
fi

# Positive control: the guard is PARTIAL. Worker 1's shift was auto-closed above, so worker 1
# may open a new one — otherwise the index would lock a worker out after their first shift.
# -q as well as -At: without it psql also echoes the `INSERT 0 1` command tag.
reopen="$(psql -Atq -v ON_ERROR_STOP=1 -d "$SCRATCH" -c "
  INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
  VALUES (1, '$LOC', now(), 'check-reopen') RETURNING 1" 2>/dev/null || true)"
[ "$reopen" = "1" ] || { echo "FAIL: worker with no OPEN shift could not clock in — guard is not partial" >&2; fail=1; }

[ "$fail" -eq 0 ] || exit 1
echo "check-autoclose PASSED: run1=1 row, run2=0 rows, flags correct, fresh shift untouched, double-punch rejected"
