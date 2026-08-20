#!/bin/sh
# THE NEGATIVE CASE FOR check-reset-w1.mjs's AC#8 — the only test in that file that runs
# over the CLIENT'S OWN ROWS, and therefore the only one whose silence costs anything.
#
#   sh ops/check-reset-w1-mutants.sh /tmp/nfc-prod.sql.gz
#
# Each mutant edits ONE site in ops/reset-w1.sql (never in the check), runs the check
# against the same real dump, and demands a NON-ZERO exit. Then it restores the file and
# demands a ZERO exit again, so a mutant that fails to revert cannot leave a green run
# behind it. Same shape and same reasoning as server/db/check-field-wire-mutants.sh.
#
# WHY THIS EXISTS ALONGSIDE THAT ONE. check-reset-w1.mjs already generates its own RED
# cases for AC#2, AC#3 and AC#5 — but it generates them from the file's text and runs them
# on databases IT seeded. Nothing was mutating the script under AC#8, so the three
# assertions AC#8 alone makes — the owner's byte-identical row, the login round-trip, and
# the whole-schema orphan sweep — had never been watched fail.
#
# MUTANT 3 IS NOT A FILE EDIT. It is the one thing a `NOT convalidated` check cannot see:
# a foreign key that is still VALID and still enforced, with an orphan seated behind its
# back through `DISABLE TRIGGER`. If the sweep does not raise on that, the sweep is
# walking nothing.
set -eu

DUMP="${1:-}"
[ -n "$DUMP" ] || { echo "usage: sh ops/check-reset-w1-mutants.sh <nfc-*.sql[.gz]>" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

RESET="ops/reset-w1.sql"
BACKUP=$(mktemp -d)
trap 'cp "$BACKUP/reset-w1.sql" "$RESET" 2>/dev/null || true; rm -rf "$BACKUP"' EXIT INT TERM
cp "$RESET" "$BACKUP/reset-w1.sql"
restore_all() { cp "$BACKUP/reset-w1.sql" "$RESET"; }

pass=0
fail=0

mutate() {
  name="$1"; from="$2"; to="$3"
  restore_all
  if ! /usr/bin/grep -qF -- "$from" "$RESET"; then
    echo "DEAD  $name — site not found in $RESET: $from"
    fail=$((fail + 1))
    restore_all
    return
  fi
  FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$RESET"
  if node ops/check-reset-w1.mjs "$DUMP" >/dev/null 2>&1; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
node ops/check-reset-w1.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN baseline" \
  || { echo "BASELINE IS RED — fix that first; no mutant below means anything." >&2; exit 1; }

# ---------------------------------------------------------------------------------------
# 1 · The owner's row is destroyed AFTER section 5's guard has already run and passed.
#     `count(*) >= 1` is satisfied by the control admin AC#8 seats, so the lockout guard
#     is happy and only the byte-for-byte fingerprint can tell. This is the exact shape of
#     the mistake that assertion exists for.
# ---------------------------------------------------------------------------------------
mutate "the owner's admins row deleted after the lockout guard has passed" \
  "\\echo 'AFTER:'" \
  "DELETE FROM admins WHERE id = (SELECT min(id) FROM admins);
\\echo 'AFTER:'"

# ---------------------------------------------------------------------------------------
# 2 · Every admin password is rewritten. Row count unchanged, ids unchanged, emails
#     unchanged — the panel simply stops accepting anybody's password. Caught by the
#     fingerprint AND by the login round-trip, which is the point: the login assertion is
#     about the CODE PATH on a reset database, and this is what its failure looks like.
# ---------------------------------------------------------------------------------------
mutate "every admin password_hash rewritten — same rows, nobody can log in" \
  "DELETE FROM locations;" \
  "DELETE FROM locations;
UPDATE admins SET password_hash = 'scrypt\$16384\$8\$1\$deadbeef\$deadbeef';"

# ---------------------------------------------------------------------------------------
# 3 · AN ORPHAN BEHIND A STILL-VALID FOREIGN KEY. Not a file edit: the check is run
#     against a database that has been given one, with the FK left in place and still
#     `convalidated`. `DISABLE TRIGGER ALL` is how a restore, a bulk load or a hand-edit
#     actually produces one on a real box, and it is invisible to a pg_constraint query.
#
#     Run as a SEPARATE, self-contained scratch database, because the check's own
#     databases do not outlive it.
# ---------------------------------------------------------------------------------------
echo "== mutant 3 (not a file edit): an orphan behind a still-VALID foreign key"
ORPHAN_DB="nfc_resetw1_orphan_$$"
cleanup_orphan() { dropdb --force --if-exists "$ORPHAN_DB" >/dev/null 2>&1 || true; }
trap 'cp "$BACKUP/reset-w1.sql" "$RESET" 2>/dev/null || true; rm -rf "$BACKUP"; cleanup_orphan' EXIT INT TERM
createdb "$ORPHAN_DB"
DATABASE_URL="postgres:///$ORPHAN_DB" node server/db/migrate.js >/dev/null
psql "postgres:///$ORPHAN_DB" -v ON_ERROR_STOP=1 -q -c "
  INSERT INTO locations (slug, name) VALUES ('orphan-haus', 'Orphan Haus');
  ALTER TABLE zones DISABLE TRIGGER ALL;
  INSERT INTO zones (location_id, name) VALUES ('00000000-0000-4000-8000-000000000000', 'Zone Of A Building That Does Not Exist');
  ALTER TABLE zones ENABLE TRIGGER ALL;"

still_valid=$(psql "postgres:///$ORPHAN_DB" -t -A -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'zones%' AND contype = 'f' AND NOT convalidated")
if [ "$still_valid" != "0" ]; then
  echo "DEAD  mutant 3 — the FK went NOT VALID, so this proves nothing about the sweep"
  fail=$((fail + 1))
else
  # The exact query AC#8 runs, lifted verbatim in shape: walk every FK column, raise on
  # the first non-resolving value. It must RAISE here.
  if psql "postgres:///$ORPHAN_DB" -v ON_ERROR_STOP=1 -q -c "
    DO \$\$
    DECLARE r record; n bigint; total bigint := 0;
    BEGIN
      FOR r IN
        SELECT c.conrelid::regclass AS child, c.confrelid::regclass AS parent,
               a.attname AS col, fa.attname AS refcol
          FROM pg_constraint c
          JOIN unnest(c.conkey)  WITH ORDINALITY AS k(att, ord)  ON true
          JOIN unnest(c.confkey) WITH ORDINALITY AS fk(att, ord) ON fk.ord = k.ord
          JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = k.att
          JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = fk.att
         WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM %s ch WHERE ch.%I IS NOT NULL AND NOT EXISTS '
          '(SELECT 1 FROM %s pa WHERE pa.%I = ch.%I)',
          r.child, r.col, r.parent, r.refcol, r.col) INTO n;
        IF n > 0 THEN RAISE EXCEPTION 'ORPHAN: % rows in %.% do not resolve to %', n, r.child, r.col, r.parent; END IF;
        total := total + 1;
      END LOOP;
    END \$\$;" >/dev/null 2>&1; then
    echo "ALIVE mutant 3 — the orphan sweep did NOT raise on a real orphan. It walks nothing."
    fail=$((fail + 1))
  else
    echo "RED   an orphan behind a still-VALID foreign key (pg_constraint sees nothing wrong)"
    pass=$((pass + 1))
  fi
fi
cleanup_orphan

restore_all
echo "== the tree is restored; re-running the check must be GREEN again"
node ops/check-reset-w1.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN after revert" \
  || { echo "STILL RED after revert — ops/reset-w1.sql was not restored cleanly." >&2; exit 1; }

if ! /usr/bin/git diff --quiet -- "$RESET"; then
  echo "ops/reset-w1.sql is NOT byte-identical to HEAD after this run — restore it by hand." >&2
  exit 1
fi

echo
echo "mutants: $pass red, $fail alive-or-dead"
[ "$fail" -eq 0 ] || exit 1
echo "OK check-reset-w1-mutants: every mutant red, tree byte-identical"
