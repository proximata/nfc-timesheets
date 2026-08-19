#!/bin/sh
# THE NEGATIVE CASE FOR THE TWO NAMED ALLOWLISTS.
#
#   «stack» running on 127.0.0.1:8080 with PUBLIC_DIR=web/out
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" sh demo/audit-allowlist-mutants.sh
#
# demo/audit-contrast.mjs and demo/audit-phone.mjs exited 1 on every run for months
# (REDESIGN-REVIEW.md R3). Each of those reds was argued and accepted in REDESIGN-FIX.md §5,
# so the scripts now CLASSIFY them instead of failing on them — and the obvious way to get
# that wrong is to write an exception so wide it swallows the next real defect. This proves
# it does not, in FOUR directions, with two rebuilds:
#
#   PASS 1 — the world gets worse
#     · --border darkened            -> audit-contrast must FAIL („WORSE THAN THE ACCEPTED")
#     · .btn min-height 44px -> 30px -> audit-phone must FAIL (a real control, not excepted)
#
#   PASS 2 — the exception's own boundary
#     · --border raised to clear 3:1 -> audit-contrast must FAIL (STALE EXCEPTION: an entry
#                                       on the accepted list that no longer fails is a lie
#                                       about the tree, and would absorb the next regression)
#     · .brand min-height 24px->20px -> audit-phone must FAIL (24x24 is the whole reason the
#                                       brand is excepted; below it, it is excepted no more)
#
# web/app/globals.css is restored and rebuilt in an EXIT trap, and the run ends by asserting
# `git status --porcelain web/` is empty. A mutant left on disk is worse than no mutation
# test, because the next run measures it and believes it.
set -u
cd "$(dirname "$0")/.."

CSS=web/app/globals.css
LOG=/tmp/recheck/allowlist
mkdir -p "$LOG"

MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-}"
if [ -z "$MAPS_KEY" ]; then
  echo "audit-allowlist-mutants: NEXT_PUBLIC_GOOGLE_MAPS_KEY is empty."
  exit 1
fi
BASE="${AUDIT_BASE:-http://127.0.0.1:8080}"

build() {
  ( cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" NEXT_PUBLIC_API_BASE_URL="" \
      NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build ) >/dev/null 2>&1 \
    || { echo "  FAIL the mutant did not build"; return 1; }
}
restore() {
  git checkout -- "$CSS" 2>/dev/null
  echo "  … rebuilding the fixed tree"
  build
}
trap restore EXIT

fails=0

# `must_fail <script> <tag> <grep for the line that proves the RIGHT assertion caught it>`
must_fail() {
  script=$1; tag=$2; needle=$3
  AUDIT_BASE="$BASE" node "demo/$script" > "$LOG/$tag.log" 2>&1
  if [ $? -eq 0 ]; then
    echo "  FAIL $script is GREEN under $tag — the allowlist swallowed it"
    fails=$((fails + 1))
  elif grep -q "$needle" "$LOG/$tag.log"; then
    echo "  ok   $script is RED under $tag:"
    grep -- "$needle" "$LOG/$tag.log" | head -3 | sed 's/^/       /'
  else
    echo "  FAIL $script is red under $tag but for the WRONG reason (no \"$needle\")"
    grep 'FAIL' "$LOG/$tag.log" | head -3 | sed 's/^/       /'
    fails=$((fails + 1))
  fi
}

# --- PASS 1 ---------------------------------------------------------------------------
echo "=== PASS 1 · the hairline gets darker, and a real button shrinks ==="
python3 - "$CSS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
# The dark-theme --border, and the light one, both pushed further down.
assert '  --border: rgba(255, 255, 255, 0.08);' in s, 'dark --border moved'
assert '  --border: rgba(0, 0, 0, 0.1);' in s, 'light --border moved'
s = s.replace('  --border: rgba(255, 255, 255, 0.08);', '  --border: rgba(255, 255, 255, 0.02);', 1)
s = s.replace('  --border: rgba(0, 0, 0, 0.1);', '  --border: rgba(0, 0, 0, 0.02);', 1)
# .btn's 44px floor — the first `min-height: 44px` in the file is the button's.
i = s.index('  min-height: 44px;')
s = s[:i] + '  min-height: 30px;' + s[i + len('  min-height: 44px;'):]
open(p, 'w', encoding='utf-8').write(s)
print('  mutated', p)
PY
[ $? -eq 0 ] || exit 1
build || exit 1
must_fail audit-contrast.mjs contrast-worse 'WORSE THAN THE ACCEPTED'
must_fail audit-phone.mjs phone-small-button '<44px:'
git checkout -- "$CSS"

# --- PASS 2 ---------------------------------------------------------------------------
echo ""
echo "=== PASS 2 · the hairline is FIXED, and the brand drops under 24px ==="
python3 - "$CSS" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
assert '  --border: rgba(255, 255, 255, 0.08);' in s, 'dark --border moved'
assert '  --border: rgba(0, 0, 0, 0.1);' in s, 'light --border moved'
# Opaque greys that clear 3:1 on both bases — the accepted rows must then go STALE.
s = s.replace('  --border: rgba(255, 255, 255, 0.08);', '  --border: #6a6f77;', 1)
s = s.replace('  --border: rgba(0, 0, 0, 0.1);', '  --border: #767b82;', 1)
old = """     exception does not cover it. It measured 23px — one pixel under. */
  min-height: 24px;"""
assert old in s, '.brand min-height moved'
s = s.replace(old, """     exception does not cover it. It measured 23px — one pixel under. */
  min-height: 20px;""", 1)
open(p, 'w', encoding='utf-8').write(s)
print('  mutated', p)
PY
[ $? -eq 0 ] || exit 1
build || exit 1
must_fail audit-contrast.mjs contrast-stale 'stale exception'
must_fail audit-phone.mjs phone-small-brand '<44px:'

restore
trap - EXIT

dirty=$(git status --porcelain web/)
if [ -n "$dirty" ]; then
  echo ""
  echo "  FAIL web/ is dirty after the run — a mutant is still on disk:"
  echo "$dirty" | sed 's/^/       /'
  fails=$((fails + 1))
else
  echo ""
  echo "  ok   web/ is clean again and rebuilt from the fixed source"
fi

echo ""
[ "$fails" -eq 0 ] && echo "audit-allowlist-mutants: all four negative cases fire." \
  || echo "audit-allowlist-mutants: $fails PROBLEM(S)."
exit "$fails"
