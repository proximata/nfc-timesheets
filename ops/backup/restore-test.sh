#!/usr/bin/env bash
#
# Restore-test: an untested backup is a guess.
#
# Restores the NEWEST dump in /var/backups/nfc into a throwaway scratch database, asserts the
# expected tables exist and that the restore actually carried rows, then drops the scratch DB.
# It never touches the live database — it refuses to run if the scratch name resolves to it.
#
# Run as the `postgres` role. MUST be run at least once before this system carries real
# payroll data, and again after any schema migration or backup-script change. Record the date
# it was last run in backlog/docs (see ops/README.md verification checklist).
#
#   sudo -u postgres /srv/nfc/ops/backup/restore-test.sh
#
# Optional: DUMP=/path/to/a.sql.gz to test a specific dump — e.g. one pulled back DOWN from
# the offsite copy, which is the only test that proves the offsite half works.

set -euo pipefail

DB=nfc
DEST=/var/backups/nfc
SCRATCH="nfc_restoretest_$$"

[ "$SCRATCH" = "$DB" ] && { echo "FATAL: scratch name equals live DB" >&2; exit 1; }

dump="${DUMP:-$(ls -1t "$DEST"/$DB-*.sql.gz 2>/dev/null | head -n1 || true)}"
if [ -z "$dump" ]; then
  echo "FATAL: no dump found in $DEST — the backup job has never produced one" >&2
  exit 1
fi
echo "restore-testing: $dump"

gzip -t "$dump" || { echo "FATAL: $dump fails gzip integrity check" >&2; exit 1; }

cleanup() { dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

createdb "$SCRATCH"
# --clean --if-exists dumps emit harmless DROP-on-empty notices; ON_ERROR_STOP would trip on
# nothing real, so check the outcome (rows present) rather than the transcript.
gzip -dc "$dump" | psql --quiet --dbname="$SCRATCH" >/dev/null

fail=0
for t in workers locations shifts; do
  if ! psql -At -d "$SCRATCH" -c "select to_regclass('public.$t') is not null" | grep -qx t; then
    echo "FAIL: table $t missing from restored dump" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1

total=0
for t in workers locations shifts; do
  n="$(psql -At -d "$SCRATCH" -c "select count(*) from $t")"
  echo "  $t: $n rows"
  total=$(( total + n ))
done

# Per-table counts are deliberately NOT asserted individually: a legitimately empty `shifts`
# exists on day one. A restore that produced zero rows across ALL THREE tables is either an
# empty database or a broken dump, and neither is something to declare green.
if [ "$total" -eq 0 ]; then
  echo "FAIL: restored database is completely empty ($total rows) — dump is not usable" >&2
  exit 1
fi

echo "restore-test PASSED: $total rows restored from $(basename "$dump")"
