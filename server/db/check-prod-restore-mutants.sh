#!/bin/sh
# THE NEGATIVE CASE FOR THE THREE THINGS check-prod-restore.mjs LEARNED IN THIS PASS —
# the migration ORDER, 007's phone registry, and 008's unbound tag. A check whose negative
# case cannot fail is not a check, and this project has shipped several that asserted over
# zero rows.
#
#   sh server/db/check-prod-restore-mutants.sh /tmp/nfc.sql.gz
#
# Scope, so it is not confused with its neighbour: check-field-wire-mutants.sh already
# mutates the TAP PATH (activePlace's building branch, the auto_closed guards). This one
# mutates the three sites that the pre-deploy rehearsal newly asserts over, and nothing else.
#
# Each mutant edits ONE site of SOURCE (never of the check), runs check-prod-restore against
# the same real dump, and demands a NON-ZERO exit. Then it restores the file and demands a
# ZERO exit again, so a mutant that fails to revert cannot leave a green run behind it.
#
# ONE MUTANT EDITS A MIGRATION FILE. db/README.md's rule that 001-008 are not editable is
# about what gets COMMITTED and applied to a box; the file is restored byte-for-byte here and
# the run refuses to end unless `git diff` agrees.
set -eu

DUMP="${1:-}"
[ -n "$DUMP" ] || { echo "usage: sh server/db/check-prod-restore-mutants.sh <nfc-*.sql[.gz]>" >&2; exit 2; }
[ -f "$DUMP" ] || { echo "no such dump: $DUMP" >&2; exit 2; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

RUNNER="server/db/migrate.js"
MIG007="server/db/migrations/007_operator_identity.sql"
VAL="server/lib/validate.js"

BACKUP=$(mktemp -d)
restore_all() { for f in "$RUNNER" "$MIG007" "$VAL"; do cp "$BACKUP/$(echo "$f" | tr / _)" "$f"; done; }
trap 'restore_all 2>/dev/null || true; rm -rf "$BACKUP"' EXIT INT TERM
for f in "$RUNNER" "$MIG007" "$VAL"; do cp "$f" "$BACKUP/$(echo "$f" | tr / _)"; done

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
  # perl -0777 and not sed: the sites below contain slashes, braces and newlines.
  FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if node server/db/check-prod-restore.mjs "$DUMP" >/dev/null 2>&1; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
node server/db/check-prod-restore.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN baseline" \
  || { echo "baseline is already RED — fix that first" >&2; exit 1; }

# 1 · THE ORDER. 007 references `workers` as 006 leaves it and 008 references `zones`, which
#     006 creates. Nothing enforces the sequence except one `.sort()` in the runner, and a
#     deploy that applies them in another order is not a deploy that half-worked — it is a
#     box left on a schema no code in this repo has ever seen.
mutate "the migration runner stops applying files in lexical order" \
  "$RUNNER" 'const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();' \
  'const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().reverse();'

# 2 · 007's WHOLE POINT (decision-45): a worker's phone and an operator's phone cannot be the
#     same number, made structurally impossible by one shared registry keyed on the number.
#     Take the key away and the collision becomes representable — two rows, one phone, two
#     identities, and every "which of you is this" question answered arbitrarily from then on.
mutate "phone_identities loses its primary key — one phone can claim two identities" \
  "$MIG007" "  phone_e164   TEXT PRIMARY KEY CHECK" \
  "  phone_e164   TEXT CHECK"

# 3 · 008's distinction: "ours, written and reported, nobody has resolved it yet" collapses
#     back into "not ours at all". Both still refuse the tap, so no shift is created either
#     way — but the worker in the stairwell gets the wrong German sentence, and the office
#     never learns that the card it is holding is one of its own.
mutate "an UNBOUND reported tag stops being distinguishable from a stranger's tag" \
  "$VAL" 'if (reported && reported.resolved_at === null) fail(422, "tag_unbound");' \
  'if (false) fail(422, "tag_unbound");'

restore_all
echo "== the tree is restored; re-running must be GREEN again"
node server/db/check-prod-restore.mjs "$DUMP" >/dev/null 2>&1 \
  && echo "GREEN after revert" \
  || { echo "STILL RED after revert — a mutant was not restored cleanly." >&2; exit 1; }

if ! /usr/bin/git diff --quiet -- "$RUNNER" "$MIG007" "$VAL"; then
  echo "source is NOT byte-identical to HEAD after this run — restore it by hand." >&2
  exit 1
fi

echo
echo "mutants: $pass red, $fail alive-or-dead"
[ "$fail" -eq 0 ] || exit 1
echo "OK check-prod-restore-mutants: every mutant red, tree byte-identical"
