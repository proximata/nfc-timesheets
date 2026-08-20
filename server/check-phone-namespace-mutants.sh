#!/bin/sh
# THE NEGATIVE CASE FOR check-phone-namespace.mjs.
#
#   sh server/check-phone-namespace-mutants.sh              # self-contained scratch DB
#   sh server/check-phone-namespace-mutants.sh /tmp/nfc.sql.gz   # ...on the client's rows
#
# That check was written by an agent that died before reporting, and it makes the single
# claim the owner asked for by name — "operator phones and worker phones live in ONE
# namespace and may never collide". A check nobody has watched fail is not evidence, and
# this project has already shipped five that passed over zero rows.
#
# Each mutant edits ONE site of SOURCE — the migration, the validator, or the route — runs
# check-phone-namespace against it, and demands a NON-ZERO exit. Then it restores the file
# and demands a ZERO exit again, so a mutant that fails to revert cannot leave a green run
# behind it. Same shape and same reasoning as server/db/check-field-wire-mutants.sh.
#
# WHY SOURCE AND NOT THE CHECK. Mutating an assertion proves the assertion runs. Mutating
# the code proves the assertion CATCHES the regression it was written for.
set -eu

DUMP="${1:-}"
[ -z "$DUMP" ] || [ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

MIG="server/db/migrations/007_operator_identity.sql"
VAL="server/lib/validate.js"
ADM="server/routes/admin.js"
APP="server/routes/app.js"
FILES="$MIG $VAL $ADM $APP"

BACKUP=$(mktemp -d)
key() { echo "$1" | tr / _; }
trap 'for f in $FILES; do b="$BACKUP/$(key "$f")"; [ -f "$b" ] && cp "$b" "$f"; done; rm -rf "$BACKUP"' EXIT INT TERM
for f in $FILES; do cp "$f" "$BACKUP/$(key "$f")"; done
restore_all() { for f in $FILES; do cp "$BACKUP/$(key "$f")" "$f"; done; }

run_check() {
  if [ -n "$DUMP" ]; then node server/check-phone-namespace.mjs "$DUMP" >/dev/null 2>&1
  else node server/check-phone-namespace.mjs >/dev/null 2>&1
  fi
}

pass=0
fail=0

mutate() {
  name="$1"; file="$2"; from="$3"; to="$4"
  restore_all
  if ! /usr/bin/grep -qF -- "$from" "$file"; then
    echo "DEAD  $name — site not found in $file"
    fail=$((fail + 1))
    restore_all
    return
  fi
  # perl -0777 and not sed: the sites below carry slashes, braces and newlines.
  FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if run_check; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
run_check && echo "GREEN baseline" \
  || { echo "BASELINE IS RED — fix that first; no mutant below means anything." >&2; exit 1; }

# ---------------------------------------------------------------------------------------
# 1 · THE NORMALISER STOPS NORMALISING. "0664 900 55 01" and "+43 664/9005501" become two
#     different primary keys, both insert, and a PRIMARY KEY on the raw spelling catches
#     nothing. This is the mutant that separates "the same string twice" from "the same
#     NUMBER twice", which is the owner's actual sentence.
# ---------------------------------------------------------------------------------------
mutate "identityPhone stops normalising — the two spellings become two identities" \
  "$VAL" \
  '  if (!/^\+[1-9][0-9]{7,14}$/.test(digits)) fail(422, "invalid_phone", field);
  return digits;' \
  '  if (!/^\+[1-9][0-9]{7,14}$/.test(digits)) fail(422, "invalid_phone", field);
  return stripped;'

# ---------------------------------------------------------------------------------------
# 2 · THE PRIMARY KEY BECOMES A PLAIN COLUMN. Decision-45 §2's entire argument is that the
#     collision is refused by the DATABASE inside the same transaction, not by a screen.
#     Without the PK, both the cross-kind direct INSERT and the concurrent race succeed.
# ---------------------------------------------------------------------------------------
mutate "phone_identities.phone_e164 loses its PRIMARY KEY" \
  "$MIG" \
  "phone_e164   TEXT PRIMARY KEY CHECK" \
  "phone_e164   TEXT NOT NULL CHECK"

# ---------------------------------------------------------------------------------------
# 3 · operator_id LOSES ITS UNIQUE. "Multiple operator phones allowed" starts meaning one
#     operator with two numbers, which is the ambiguity the owner described.
# ---------------------------------------------------------------------------------------
mutate "phone_identities.operator_id loses UNIQUE — one operator may hold two numbers" \
  "$MIG" \
  "operator_id  BIGINT UNIQUE REFERENCES operators(id)" \
  "operator_id  BIGINT REFERENCES operators(id)"

# ---------------------------------------------------------------------------------------
# 4 · THE 409 STARTS NAMING WHO HOLDS THE NUMBER. Anti-enumeration (decision-45 §7): the
#     panel must not become a directory of who is enrolled. The worker-held and
#     operator-held refusals are compared byte for byte, so a single extra key kills it.
# ---------------------------------------------------------------------------------------
mutate "the 409 leaks which kind of person holds the number" \
  "$ADM" \
  'if (err?.code === "23505") fail(409, "phone_claimed");' \
  'if (err?.code === "23505") fail(409, "phone_claimed", "operator");'

# ---------------------------------------------------------------------------------------
# 5 · AN OPERATOR SESSION IS GRANTED THE CLOCK-IN ROUTE. decision-45 §3's "structural, not
#     a promise a handler could forget" — the one thing the owner said an operator is not.
# ---------------------------------------------------------------------------------------
mutate "POST /shifts/open accepts an operator session" \
  "$APP" \
  'method: "POST", path: "/shifts/open", auth: "worker"' \
  'method: "POST", path: "/shifts/open", auth: "operator"'

# ---------------------------------------------------------------------------------------
# 6 · THE CLAIMS CHECK GOES. A phone_identities row that claims nobody becomes legal, and
#     the registry stops meaning "this number belongs to someone".
# ---------------------------------------------------------------------------------------
mutate "phone_identities_claims removed — a row may claim nobody" \
  "$MIG" \
  "CONSTRAINT phone_identities_claims CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL)" \
  "CONSTRAINT phone_identities_claims CHECK (true)"

restore_all
echo "== the tree is restored; re-running the check must be GREEN again"
run_check && echo "GREEN after revert" \
  || { echo "STILL RED after revert — the tree was not restored cleanly." >&2; exit 1; }

if ! /usr/bin/git diff --quiet -- $FILES; then
  echo "source is NOT byte-identical to HEAD after this run — restore it by hand." >&2
  exit 1
fi

echo
echo "mutants: $pass red, $fail alive-or-dead"
[ "$fail" -eq 0 ] || exit 1
echo "OK check-phone-namespace-mutants: every mutant red, tree byte-identical"
