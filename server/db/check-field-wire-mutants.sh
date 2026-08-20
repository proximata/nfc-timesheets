#!/bin/sh
# THE NEGATIVE CASE FOR check-field-wire.mjs. A check whose negative case cannot fail is
# not a check, and this project has already shipped several that asserted over zero rows.
#
#   sh server/db/check-field-wire-mutants.sh /tmp/nfc.sql.gz
#
# Each mutant edits ONE line of SOURCE (never of the check), runs check-field-wire against
# the same real dump, and demands a NON-ZERO exit. Then it restores the file and demands a
# ZERO exit again, so a mutant that fails to revert cannot leave a green run behind it.
#
# WHY SOURCE AND NOT THE CHECK. Mutating the assertion proves the assertion runs. Mutating
# the code proves the assertion would CATCH the regression it was written for — which is
# the only question worth asking of a pre-deploy gate.
set -eu

DUMP="${1:-}"
[ -n "$DUMP" ] || { echo "usage: sh server/db/check-field-wire-mutants.sh <nfc-*.sql[.gz]>" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

APP="server/routes/app.js"
MIG="server/db/migrations/006_zones_revenue_rates.sql"
VAL="server/lib/validate.js"

BACKUP=$(mktemp -d)
trap 'for f in "$APP" "$MIG" "$VAL"; do b="$BACKUP/$(echo "$f" | tr / _)"; [ -f "$b" ] && cp "$b" "$f"; done; rm -rf "$BACKUP"' EXIT INT TERM
for f in "$APP" "$MIG" "$VAL"; do cp "$f" "$BACKUP/$(echo "$f" | tr / _)"; done

restore_all() { for f in "$APP" "$MIG" "$VAL"; do cp "$BACKUP/$(echo "$f" | tr / _)" "$f"; done; }

pass=0
fail=0

# mutate NAME (FILE FROM TO)... — variadic, because one regression is sometimes spread over
# several guards and any single edit is masked by the others. See mutant 1.
mutate() {
  name="$1"; shift
  restore_all
  missing=0
  set -- "$@"
  args=""
  while [ $# -ge 3 ]; do
    file="$1"; from="$2"; to="$3"; shift 3
    if ! /usr/bin/grep -qF -- "$from" "$file"; then
      echo "DEAD  $name — site not found in $file: $from"
      missing=1
      break
    fi
    # `perl -0777 -pe` and not sed: the sites below contain slashes, braces and newlines.
    FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  done
  if [ "$missing" -eq 1 ]; then
    fail=$((fail + 1))
    restore_all
    return
  fi
  if node server/db/check-field-wire.mjs "$DUMP" >/dev/null 2>&1; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
node server/db/check-field-wire.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN baseline" \
  || { echo "baseline is already RED — fix that first" >&2; exit 1; }

# 1 · auto_closed stops being monotonic: the phone's replayed tap-out clears a flag the 8h
#     timer or a cross-building tap had raised (decision-10), the resolution screen never
#     appears, and an end time nobody confirmed becomes payroll.
#
#     THREE EDITS, DELIBERATELY, and the reason is a finding in itself. Three guards stack
#     here and ANY ONE of them alone holds the property, so a single-edit mutant survives
#     and proves nothing:
#       (a) the idempotent-close early return, which a replay hits first;
#       (b) `AND end_time IS NULL` on the UPDATE;
#       (c) `auto_closed = auto_closed OR $3`.
#     (c) is the line check-close-flag.mjs greps for and is the WEAKEST of the three: no
#     path in this system produces an OPEN shift with auto_closed already true
#     (ops/sql/autoclose.sql sets end_time and the flag in the same UPDATE), so on the
#     rows (b) admits, `auto_closed` is always false and the OR is a no-op. Removing (c)
#     alone changes no observable behaviour — measured, not reasoned.
mutate "the three guards that keep a replay from clearing auto_closed, removed together" \
  "$APP" "  if (current.end_time !== null) {" "  if (false) {" \
  "$APP" "WHERE client_uuid = \$1 AND worker_id = \$4 AND end_time IS NULL RETURNING" "WHERE client_uuid = \$1 AND worker_id = \$4 RETURNING" \
  "$APP" "auto_closed = auto_closed OR \$3" "auto_closed = \$3"

# 2 · the tap path acquires a zone predicate, which is the one line ZONES-MODEL forbids:
#     the card on the wall at HOIV names a building with zero zones and cannot be rewritten
#     from Vienna. This is the mutant that costs a site visit.
mutate "the building branch of activePlace demands a zone" \
  "$VAL" "WHERE l.id = \$1 AND l.active" \
  "WHERE l.id = \$1 AND l.active AND EXISTS (SELECT 1 FROM zones z2 WHERE z2.location_id = l.id AND z2.active)"

# 3 · a building tag silently resolves to "the first zone" — the fabrication decision-43
#     names and refuses. It would look green in every screen and put a door on a tap that
#     never touched one.
mutate "a building tag is widened to its first zone" \
  "$VAL" "SELECT l.id AS location_id, NULL::uuid AS zone_id, l.slug, l.name, NULL::text AS zone_name
       FROM locations l" \
  "SELECT l.id AS location_id, (SELECT z3.id FROM zones z3 WHERE z3.location_id = l.id AND z3.active ORDER BY z3.created_at LIMIT 1) AS zone_id, l.slug, l.name, NULL::text AS zone_name
       FROM locations l"

# 4 · the DEFAULT survives the migration. `NOT NULL` alone still lands a silent 0 on every
#     INSERT that omits the column, which is the shape of seed.sql and of every fixture in
#     check-api.js. This is the half of decision-41 that is easiest to forget.
mutate "006 keeps DEFAULT 0 on hourly_rate_cents" \
  "$MIG" "ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;" \
  "-- mutant: DROP DEFAULT removed"

# 5 · the rate CHECK is added NOT VALID: every new row is refused, every EXISTING rate-less
#     row survives, and the migration stops being the thing that makes the state
#     unrepresentable — which is the entire argument for deleting the named exclusion copy.
mutate "006 adds workers_rate_positive NOT VALID" \
  "$MIG" "ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);" \
  "ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0) NOT VALID;"

# 6 · the rate CHECK becomes >= 0, so a wage of zero is legal again. `> 0` vs `>= 0` is one
#     character and is the difference between "unpaid" and "unrepresentable".
mutate "006 allows a rate of exactly 0" \
  "$MIG" "CHECK (hourly_rate_cents > 0);" "CHECK (hourly_rate_cents >= 0);"

# 7 · a replayed open answers 409 instead of converging. The cleaner sees an error screen
#     for a shift that IS open, taps again, and the day is spent on the phone.
mutate "a replayed open conflicts instead of converging" \
  "$APP" "return { status: 200, body: { shift: existing, duplicate: true } };" \
  "return { status: 409, body: { error: \"shift_already_open\", shift: existing } };"

# 8 · /roster stops shipping zones[], so an adopted serial has no route to the phone at all
#     and KnownTags.kt can never be deleted (decision-44).
mutate "/roster drops zones[]" \
  "$APP" "return { status: 200, body: { worker: { id: session.workerId, name: session.name }, locations, zones } };" \
  "return { status: 200, body: { worker: { id: session.workerId, name: session.name }, locations } };"

restore_all
echo
echo "mutants: $pass red, $fail alive-or-dead   (8 mutants; mutant 1 carries 3 edits)"
if [ "$fail" -ne 0 ]; then exit 1; fi

echo "== the tree is restored; re-running the check must be GREEN again"
node server/db/check-field-wire.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN after revert" \
  || { echo "the tree did NOT come back green — a mutant leaked" >&2; exit 1; }
/usr/bin/git diff --quiet -- "$APP" "$MIG" "$VAL" \
  && echo "OK check-field-wire-mutants: every mutant red, tree byte-identical" \
  || { echo "git diff is NOT clean after the run" >&2; exit 1; }
