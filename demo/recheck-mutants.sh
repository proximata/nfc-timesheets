#!/bin/sh
# THE NEGATIVE CASE FOR F1 AND F2, one fix at a time.
#
#   «stack» running on 127.0.0.1:8080 with PUBLIC_DIR=web/out
#   sh demo/recheck-mutants.sh
#
# A check whose negative case cannot fail is not a check, and this project has been bitten
# by that seven times. F1 („Escape from a URL-opened panel does not dump focus on <body>")
# and F2 („Escape dismisses the info box") are both assertions about an absence, which is
# the shape most likely to pass vacuously. So each fix is REVERTED IN THE SOURCE, web/ is
# rebuilt, and demo/recheck.mjs must go RED — naming the assertion that caught it.
#
# THE MUTANTS, and why each is the real inverse of its fix:
#
#   F1  lib/useOverlay.ts `captureOpener` drops the two-line guard that refuses to treat
#       <body> as an opener. On a URL-opened surface `document.activeElement` IS <body> at
#       capture time, so the restore then focuses exactly the element the fix exists to
#       avoid. Nothing else changes; the hook still runs, Escape still closes.
#
#   F2  components/HomeMap.tsx stops adding the capture-phase keydown listener that
#       dismisses the info box. The box still opens, still has its ✕, still has focus in it
#       — only Escape stops working, which is the defect 590077f fixed.
#
# The source is restored and rebuilt in an EXIT trap, and the script ends by asserting
# `git status --porcelain web/` is empty. A mutant left on disk is worse than no mutation
# test, because the next run measures it and believes it.
set -u
cd "$(dirname "$0")/.."

OVERLAY=web/lib/useOverlay.ts
HOMEMAP=web/components/HomeMap.tsx
LOG=/tmp/recheck/mutants
mkdir -p "$LOG"

MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-}"
if [ -z "$MAPS_KEY" ]; then
  echo "recheck-mutants: NEXT_PUBLIC_GOOGLE_MAPS_KEY is empty — the info box needs a map."
  echo "  NEXT_PUBLIC_GOOGLE_MAPS_KEY=\"\$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)\" sh demo/recheck-mutants.sh"
  exit 1
fi

restore() {
  git checkout -- "$OVERLAY" "$HOMEMAP" 2>/dev/null
  echo "  … rebuilding the fixed tree"
  ( cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" NEXT_PUBLIC_API_BASE_URL="" \
      NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build ) >/dev/null 2>&1
}
trap restore EXIT

build() {
  ( cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" NEXT_PUBLIC_API_BASE_URL="" \
      NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build ) >/dev/null 2>&1 \
    || { echo "  FAIL the mutant did not build"; return 1; }
}

fails=0

# --- F1 -------------------------------------------------------------------------------
echo "=== MUTANT F1 · <body> is allowed to be an opener again ==="
python3 - "$OVERLAY" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = """  const opener =
    active instanceof HTMLElement && active !== document.body && active !== document.documentElement
      ? active
      : null"""
new = """  const opener = active instanceof HTMLElement ? active : null"""
assert old in s, 'F1 mutation site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('  mutated', p)
PY
[ $? -eq 0 ] || exit 1
build || exit 1
DEMO_BASE=http://127.0.0.1:8080 RECHECK_ONLY=f1 node demo/recheck.mjs > "$LOG/f1.log" 2>&1
if [ $? -eq 0 ]; then
  echo "  FAIL the F1 mutant is GREEN — the check does not test the fix"
  fails=$((fails + 1))
else
  echo "  ok   the F1 mutant is RED:"
  grep '  FAIL' "$LOG/f1.log" | sed 's/^/       /'
fi
git checkout -- "$OVERLAY"

# --- F2 -------------------------------------------------------------------------------
echo ""
echo "=== MUTANT F2 · the info box stops listening for Escape ==="
python3 - "$HOMEMAP" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
old = """    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      restore?.()
    }
  }, [open, onSelect])"""
new = """    void onKeyDown

    return () => {
      restore?.()
    }
  }, [open, onSelect])"""
assert old in s, 'F2 mutation site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('  mutated', p)
PY
[ $? -eq 0 ] || exit 1
build || exit 1
DEMO_BASE=http://127.0.0.1:8080 RECHECK_ONLY=f1 node demo/recheck.mjs > "$LOG/f2.log" 2>&1
if [ $? -eq 0 ]; then
  echo "  FAIL the F2 mutant is GREEN — Escape on the info box is not actually tested"
  fails=$((fails + 1))
else
  echo "  ok   the F2 mutant is RED:"
  grep '  FAIL' "$LOG/f2.log" | sed 's/^/       /'
fi

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
[ "$fails" -eq 0 ] && echo "recheck-mutants: both negative cases fire." || echo "recheck-mutants: $fails PROBLEM(S)."
exit "$fails"
