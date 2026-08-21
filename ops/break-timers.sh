#!/usr/bin/env bash
#
# THE TWO BACKGROUND JOBS NOBODY HAS EVER SEEN DO ANYTHING.
#
#     ./ops/break-timers.sh [host]
#
# `systemctl list-timers` says both are enabled and both fired minutes ago. That is not
# evidence of anything. Read the journal for nfc-autoclose: every single line since the
# unit was installed reads `UPDATE 0`. The timer has never closed a shift, because there
# has never been a shift older than eight hours to close — so the safety net decision-10
# promises the owner has, to this day, never caught anything, and nobody can say whether
# it would. Same for the backup: 20 dumps on disk, and not one of them has ever been fed
# back into a Postgres to see if it restores.
#
# THIS RUN SEEDS THE CONDITION AND SHOWS THE NEGATIVE CASE RED FIRST.
#
#   autoclose   two shifts: one 9h old, one 7h old, same worker is impossible (one open
#               shift per worker) so two throwaway workers. Run the REAL unit — not the
#               SQL by hand, the unit, so the psql invocation, the ON_ERROR_STOP, the
#               user and the file path are all the deployed ones. The 9h one MUST close
#               at start+8h with auto_closed. The 7h one MUST still be open afterwards.
#               If both close, the window is wrong. If neither closes, the net is dead.
#
#   backup      run the REAL unit, take the dump it just wrote, restore it into a scratch
#               database on the box, and compare it to production table by table. RED
#               first: the same comparison against the PREVIOUS dump — taken before this
#               run seeded rows — must MISMATCH, or the comparison is not comparing.
#
# Everything it creates is marked and deleted, and it counts what is left.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
MARK="BREAK-DELETE-ME"

FAILED=0
ok()      { printf '  ok:   %s\n' "$1"; }
bad()     { printf '  FAIL: %s\n' "$1"; FAILED=1; }
red()     { printf '  RED:  %s\n' "$1"; }
note()    { printf '  note: %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

# `-q` is not decoration: without it psql appends the command tag (`INSERT 0 1`) to the
# rows an INSERT ... RETURNING prints, and the id captured into a shell variable comes back
# as two lines. That fed `INSERT 0 1` into the next statement as a worker id.
psql_box() { ssh "$HOST" "sudo -u postgres psql -q -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

SCRATCH_DB="nfc_break_restore"

cleanup() {
  local rc=$?
  section "cleanup"
  psql_box "
    BEGIN;
    DELETE FROM shifts  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM worker_sessions WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM material_requests WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM phone_identities  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM workers WHERE name LIKE '${MARK}%';
    COMMIT;" >/dev/null || { bad "cleanup transaction FAILED — rows may survive"; rc=1; }

  ssh "$HOST" "sudo -u postgres dropdb --if-exists $SCRATCH_DB" >/dev/null 2>&1 \
    && ok "scratch database $SCRATCH_DB dropped" || bad "scratch database $SCRATCH_DB may survive"

  local left
  left=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
  echo "  after: workers/shifts/locations/admins = $left"
  [ "$left" = "0/0/1/1" ] && ok "production is exactly as it was found" \
                          || { bad "production is NOT as it was found"; rc=1; }

  if [ "$FAILED" -ne 0 ]; then echo; echo "BREAK-TIMERS FAILED"; exit 1; fi
  echo; echo "BREAK-TIMERS OK — $HOST"
  exit "$rc"
}

echo "breaking the timers on $HOST   (marker: $MARK)"

START_COUNTS=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
[ "$START_COUNTS" = "0/0/1/1" ] \
  && ok "starting from a clean box ($START_COUNTS)" \
  || { bad "the box is NOT clean: $START_COUNTS — refusing to run"; exit 1; }

WALL_ID=$(psql_box "SELECT id FROM locations LIMIT 1")
ok "the building on the wall: $WALL_ID"

trap cleanup EXIT

# =========================================================================================
section "1 · the autoclose timer has never closed a shift — has it ever been able to?"

HISTORY=$(ssh "$HOST" "sudo journalctl -u nfc-autoclose --no-pager -o cat | sort | uniq -c | sort -rn" 2>/dev/null)
note "every line the unit has ever written:"
echo "$HISTORY" | sed 's/^/        /'
echo "$HISTORY" | /usr/bin/grep -qE 'UPDATE [1-9]' \
  && note "it HAS closed a shift at some point" \
  || note "every line is UPDATE 0. The net has never caught anything in production."

# THE SIX-DAY HOLE. Found by reading that history rather than by any check: the unit runs as
# User=postgres and the file is 0640 exedev:app under 0750 directories, so until `postgres`
# was added to the `app` group the timer could not OPEN autoclose.sql at all. psql exits 1,
# systemd marks the unit failed, and nothing on this box tells anyone that. See
# ops/check-timers-ran.sh, which is the assertion that hole was missing.
DENIED=$(echo "$HISTORY" | /usr/bin/grep -c 'Permission denied' || true)
[ "${DENIED:-0}" -gt 0 ] && note "$(echo "$HISTORY" | /usr/bin/grep 'Permission denied' | /usr/bin/awk '{print $1}') firings in this journal never opened the file at all (Permission denied) — a silent outage of the 8h net"

# Two workers, because shifts_one_open_per_worker_idx allows exactly one open shift each.
OLD_W=$(psql_box "INSERT INTO workers (name, hourly_rate_cents, active) VALUES ('${MARK} 9h', 1450, true) RETURNING id")
NEW_W=$(psql_box "INSERT INTO workers (name, hourly_rate_cents, active) VALUES ('${MARK} 7h', 1450, true) RETURNING id")
[ -n "$OLD_W" ] && [ -n "$NEW_W" ] || { bad "could not seed workers"; exit 1; }

OLD_UUID=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
NEW_UUID=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')

# 9h ago and 7h ago. The window is 8h, so exactly one of these must move.
psql_box "INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
          VALUES ($OLD_W, '$WALL_ID', now() - INTERVAL '9 hours', '$OLD_UUID'),
                 ($NEW_W, '$WALL_ID', now() - INTERVAL '7 hours', '$NEW_UUID')" >/dev/null

BEFORE=$(psql_box "SELECT count(*) FROM shifts WHERE end_time IS NULL")
[ "$BEFORE" = "2" ] && ok "two open shifts seeded, 9h and 7h old" || { bad "seeded $BEFORE open shifts"; exit 1; }

# THE REAL UNIT, not the SQL by hand. If the deployed unit file points at a path that no
# longer exists, or runs as a role that cannot write, this is where it shows.
SINCE=$(ssh "$HOST" 'date +%s')
ssh "$HOST" "sudo systemctl start nfc-autoclose" >/dev/null 2>&1
UNIT_RC=$(ssh "$HOST" "systemctl show nfc-autoclose -p ExecMainStatus --value")
[ "$UNIT_RC" = "0" ] && ok "nfc-autoclose.service ran and exited 0" || bad "nfc-autoclose exited $UNIT_RC"

# THE UNIT'S OWN OUTPUT, NOT SYSTEMD'S. journald interleaves systemd's "Finished ..." line with
# the process's stdout, and which lands last is a race — a bare tail -1 read back
# "Finished nfc-autoclose.service" and called the timer broken. Match the command tag itself.
TAG=$(ssh "$HOST" "sudo journalctl -u nfc-autoclose --since '@$SINCE' --no-pager -o cat" 2>/dev/null | /usr/bin/grep -E "^(UPDATE [0-9]+|psql:)" | tail -1)
[ "$TAG" = "UPDATE 1" ] \
  && ok "the unit's own journal line is '$TAG' — it closed exactly one shift" \
  || bad "the unit logged '$TAG', want 'UPDATE 1'"

OLD_ROW=$(psql_box "SELECT coalesce(end_time::text,'OPEN') || '|' || auto_closed || '|' || coalesce(corrected_at::text,'NULL') || '|' || (end_time - start_time)::text FROM shifts WHERE client_uuid = '$OLD_UUID'")
case "$OLD_ROW" in
  OPEN*)  bad "the 9h shift is STILL OPEN — the 8h net does not fire: $OLD_ROW" ;;
  *"|true|NULL|08:00:00") ok "the 9h shift closed at start+8h, auto_closed=true, corrected_at=NULL: $OLD_ROW" ;;
  *) bad "the 9h shift closed WRONG: $OLD_ROW" ;;
esac

# THE NEGATIVE CASE. A timer that closes everything open is not a safety net, it is a bug
# that happens to make the positive assertion green.
NEW_ROW=$(psql_box "SELECT coalesce(end_time::text,'OPEN') || '|' || auto_closed FROM shifts WHERE client_uuid = '$NEW_UUID'")
[ "$NEW_ROW" = "OPEN|false" ] \
  && ok "the 7h shift is untouched ($NEW_ROW) — the window is a window, not a broom" \
  || bad "the 7h shift was closed too: $NEW_ROW — the 8h boundary is not being honoured"

# And the same file run twice must be a no-op, which is the claim autoclose.sql makes about
# itself and which nothing has checked.
ssh "$HOST" "sudo systemctl start nfc-autoclose" >/dev/null 2>&1
AGAIN=$(ssh "$HOST" "sudo journalctl -u nfc-autoclose --since '@$SINCE' --no-pager -o cat" 2>/dev/null | /usr/bin/grep -E "^(UPDATE [0-9]+|psql:)" | tail -1)
[ "$AGAIN" = "UPDATE 0" ] \
  && ok "running it again updates 0 rows — idempotent, as the file claims" \
  || bad "the second run said '$AGAIN' — the timer is not idempotent"

# What the WORKER sees afterwards: the shift the timer closed must land in the resolution
# queue, not silently in payroll. That is the whole point of decision-10.
UNRESOLVED=$(psql_box "SELECT count(*) FROM shifts WHERE auto_closed AND corrected_at IS NULL AND worker_id = $OLD_W")
[ "$UNRESOLVED" = "1" ] \
  && ok "the closed shift is in the worker's resolution queue (GET /shifts/unresolved would return it)" \
  || bad "the auto-closed shift is NOT unresolved — it would go to payroll with an end time nobody confirmed"

# =========================================================================================
section "2 · the backup: 20 dumps on disk and not one has ever been restored"

# The PREVIOUS dump — written before this run seeded two workers and two shifts. It is the
# RED case: restoring it must NOT match production, because production has moved.
# The glob has to be expanded BY ROOT, on the box: /var/backups/nfc is 0700 postgres, so the
# shell that ssh gives us cannot even list it and a bare `sudo ls <glob>` expands to nothing.
PREV=$(ssh "$HOST" "sudo bash -c '/bin/ls -1t /var/backups/nfc/nfc-*.sql.gz | head -1'")
[ -n "$PREV" ] && ok "the newest dump before this run: $(basename "$PREV")" || { bad "no dumps on the box at all"; exit 1; }

SINCE=$(ssh "$HOST" 'date +%s')
ssh "$HOST" "sudo systemctl start nfc-backup" >/dev/null 2>&1
BK_RC=$(ssh "$HOST" "systemctl show nfc-backup -p ExecMainStatus --value")
[ "$BK_RC" = "0" ] && ok "nfc-backup.service ran and exited 0" || bad "nfc-backup exited $BK_RC"
BK_LINE=$(ssh "$HOST" "sudo journalctl -u nfc-backup --since '@$SINCE' --no-pager -o cat" 2>/dev/null | /usr/bin/grep -E "^(backup ok:|FATAL)" | tail -1)
case "$BK_LINE" in
  "backup ok: "*) ok "the unit's own line: $BK_LINE" ;;
  *) bad "the backup unit logged '$BK_LINE'" ;;
esac

FRESH=$(ssh "$HOST" "sudo bash -c '/bin/ls -1t /var/backups/nfc/nfc-*.sql.gz | head -1'")
[ "$FRESH" != "$PREV" ] && ok "it wrote a NEW file: $(basename "$FRESH")" || bad "no new dump appeared — the unit ran and produced nothing"

# THE FINGERPRINT. Not `count(*)` alone: a count matches for two databases with the same
# number of different rows. md5 of the ordered payroll-relevant columns.
FINGERPRINT_SQL="SELECT
   (SELECT count(*) FROM workers)   || '/' ||
   (SELECT count(*) FROM shifts)    || '/' ||
   (SELECT count(*) FROM locations) || '/' ||
   (SELECT count(*) FROM admins)    || '/' ||
   (SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) FROM (
      SELECT id::text || w.name || w.hourly_rate_cents::text || w.active::text AS t FROM workers w
      UNION ALL SELECT client_uuid || start_time::text || coalesce(end_time::text,'-') || auto_closed::text FROM shifts
      UNION ALL SELECT id::text || l.slug || l.active::text FROM locations l
   ) s)"

PROD_FP=$(psql_box "$FINGERPRINT_SQL")
[ -n "$PROD_FP" ] && ok "production fingerprint: $PROD_FP" || { bad "could not fingerprint production"; exit 1; }

restore_and_fingerprint() {
  local dump="$1"
  ssh "$HOST" "sudo -u postgres dropdb --if-exists $SCRATCH_DB && sudo -u postgres createdb $SCRATCH_DB && \
               sudo -u postgres bash -c 'gzip -dc $dump | psql -q -d $SCRATCH_DB' " >/dev/null 2>&1
  ssh "$HOST" "sudo -u postgres psql -d $SCRATCH_DB -Atc \"$FINGERPRINT_SQL\"" 2>/dev/null
}

# --- RED FIRST: the stale dump must NOT match ---
PREV_FP=$(restore_and_fingerprint "$PREV")
[ -n "$PREV_FP" ] || { bad "the PREVIOUS dump would not restore at all — that is worse than a mismatch"; }
if [ "$PREV_FP" = "$PROD_FP" ]; then
  bad "the dump from BEFORE this run's seed matches production — the comparison cannot tell two databases apart"
else
  red "the stale dump restores to $PREV_FP, production is $PROD_FP — different, as it must be"
  ok "the comparison has a negative case that fails"
fi

# --- GREEN: the dump taken moments ago must match, exactly ---
FRESH_FP=$(restore_and_fingerprint "$FRESH")
[ "$FRESH_FP" = "$PROD_FP" ] \
  && ok "the dump written minutes ago restores to a database IDENTICAL to production: $FRESH_FP" \
  || bad "the FRESH dump restores to $FRESH_FP but production is $PROD_FP — THE BACKUP DOES NOT ROUND-TRIP"

# The schema, not just the rows: a restore that loses the partial unique index would let a
# worker open two shifts at once on the restored box and nobody would find out until payroll.
IDX_PROD=$(psql_box "SELECT count(*) FROM pg_indexes WHERE schemaname='public'")
IDX_REST=$(ssh "$HOST" "sudo -u postgres psql -d $SCRATCH_DB -Atc \"SELECT count(*) FROM pg_indexes WHERE schemaname='public'\"")
[ "$IDX_PROD" = "$IDX_REST" ] && ok "the restored database has the same $IDX_PROD indexes" || bad "indexes: production $IDX_PROD, restored $IDX_REST"

ONE_OPEN=$(ssh "$HOST" "sudo -u postgres psql -d $SCRATCH_DB -Atc \"SELECT indexdef FROM pg_indexes WHERE indexname='shifts_one_open_per_worker_idx'\"")
[ -n "$ONE_OPEN" ] \
  && ok "the one-open-shift-per-worker index survived the round trip" \
  || bad "shifts_one_open_per_worker_idx is MISSING from the restored database"

MIG_REST=$(ssh "$HOST" "sudo -u postgres psql -d $SCRATCH_DB -Atc \"SELECT count(*) FROM schema_migrations\"")
MIG_PROD=$(psql_box "SELECT count(*) FROM schema_migrations")
[ "$MIG_REST" = "$MIG_PROD" ] && ok "schema_migrations restored: $MIG_REST rows, same as production" || bad "migrations: prod $MIG_PROD, restored $MIG_REST"

# =========================================================================================
section "3 · the backup runs while a migration runs"
#
# Both timers and every deploy share one Postgres, and nothing schedules around anything.
# nfc-backup fires at 00:13 and a deploy runs `db/migrate.js` whenever someone deploys, so
# the overlap is a matter of time, not of design.
#
# THE HAZARD IS LOCKS, not corruption. pg_dump takes ACCESS SHARE on every table and holds it
# for the whole dump; a migration's ALTER TABLE needs ACCESS EXCLUSIVE and cannot get it while
# that is held. Postgres queues the ALTER — and then queues EVERY LATER QUERY ON THAT TABLE
# BEHIND THE ALTER, because lock requests are ordered. So a migration that merely waits can
# stall clock-ins for as long as the dump takes. That is the mechanism; this measures it.

LOCK_SECS="${MIGRATION_LOCK_SECS:-8}"
# A migration's worst moment, reproduced exactly: ACCESS EXCLUSIVE on `shifts`, held.
ssh "$HOST" "sudo -u postgres psql -q -d nfc -c 'BEGIN; LOCK TABLE shifts IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep($LOCK_SECS); COMMIT;'" >/dev/null 2>&1 &
LOCK_PID=$!
sleep 1

# a) the dump, started INSIDE that window. `systemctl start` is synchronous for a oneshot, so
#    the wall time it takes IS the time pg_dump spent queueing for ACCESS SHARE.
T0=$(ssh "$HOST" 'date +%s')
ssh "$HOST" "sudo systemctl start nfc-backup" >/dev/null 2>&1 &
DUMP_PID=$!
# The clock-in's query is fired while BOTH are outstanding, so it is behind the migration and
# behind the dump — which is the real shape of the collision, and the reason ordering matters
# here: measuring it after the dump returned found the lock already gone and reported 0s.
sleep 2
T2=$(ssh "$HOST" 'date +%s')
ssh "$HOST" "sudo -u postgres psql -q -d nfc -Atc 'SELECT count(*) FROM shifts'" >/dev/null 2>&1
T3=$(ssh "$HOST" 'date +%s')
wait $DUMP_PID 2>/dev/null
T1=$(ssh "$HOST" 'date +%s')
BRC=$(ssh "$HOST" "systemctl show nfc-backup -p ExecMainStatus --value")
WAITED=$((T1 - T0))
note "the dump started while an ACCESS EXCLUSIVE lock was held: exit $BRC, took ~${WAITED}s (it queued for the lock)"
[ "$BRC" = "0" ] \
  && ok "it still produced a verified dump — it WAITED for the lock rather than writing a truncated file or failing the unit" \
  || bad "the backup exited $BRC when it collided with a migration lock"

# b) AND THE QUERY A CLOCK-IN MAKES. Measured against `shifts` itself, on the box, inside the
#    same window — not through an unauthenticated HTTP call that would 401 before it ever
#    touched the table and would have reported a healthy few milliseconds while the table was
#    unusable. What is being timed is the LOCK QUEUE, so it has to be a query that joins it.
BLOCKED_FOR=$((T3 - T2))
note "a SELECT on shifts issued during the lock waited ${BLOCKED_FOR}s for an answer"
if [ "$BLOCKED_FOR" -ge 2 ]; then
  ok "CONFIRMED: an ACCESS EXCLUSIVE lock stalls the very query a clock-in makes, for as long as it is held. A migration that queues behind a dump therefore queues every clock-in behind itself."
else
  note "it answered in ${BLOCKED_FOR}s — the lock had already been released by then, so this run did not catch the queue. Raise MIGRATION_LOCK_SECS and re-run."
fi
wait $LOCK_PID 2>/dev/null
AFTER=$(psql_box "SELECT count(*) FROM shifts")
[ -n "$AFTER" ] && ok "the lock is released and shifts answers again ($AFTER rows)" || bad "shifts is still locked"
note "MITIGATION, not done here: nothing schedules the backup away from deploys, and db/migrate.js sets no lock_timeout. On a 7 KB database the dump is milliseconds and the window is invisible; the day this database is a year of payroll it will not be. Filed."

# =========================================================================================
section "4 · what the dump does NOT protect against"
DEST_FS=$(ssh "$HOST" "df --output=source /var/backups/nfc | tail -1")
DB_FS=$(ssh "$HOST" "df --output=source /var/lib/postgresql | tail -1")
if [ "$DEST_FS" = "$DB_FS" ]; then
  note "every dump is on $DEST_FS, the SAME filesystem as the database. It survives DROP TABLE and a bad migration. It survives NOTHING that kills the disk or the VM. pg-backup.sh says so itself; the offsite hook is still a TODO."
else
  ok "the dumps live on $DEST_FS, separate from the database on $DB_FS"
fi
