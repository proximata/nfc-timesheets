#!/bin/sh
# THE NEGATIVE CASE FOR THE NINE FIXES demo/recheck-mutants.sh DOES NOT COVER.
#
#   «stack» seeded nfc_demo + the API serving a build of web/ on 127.0.0.1:8080 (loopback)
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY="$(psst get NEXT_PUBLIC_GOOGLE_MAPS_KEY)" sh demo/fix-mutants.sh
#   NEXT_PUBLIC_GOOGLE_MAPS_KEY=… sh demo/fix-mutants.sh v1 fold t177   # a subset
#
# A CHECK WHOSE NEGATIVE CASE CANNOT FAIL IS NOT A CHECK. That has bitten this tree seven
# times, so demo/recheck-mutants.sh proves F1 and F2 fire and demo/audit-allowlist-mutants.sh
# proves the two named allowlists fire. This file is the rest of the list: the four salvage
# fixes of 590077f and the five gallery fixes of c446dcf/a003674, each REVERTED IN THE SOURCE
# until the check that claims to prove it goes RED, then restored.
#
# THE MUTANTS, and why each is the real inverse of its fix. „Real inverse" matters: a mutant
# that deletes the whole feature proves only that the check notices an empty screen.
#
#   v1    globals.css caps `.map-info` at 160px instead of 440px. The expander still exists,
#         still says how many, still has 44px, still toggles, and every link is still REACHABLE
#         — by scrolling `.map-info-face`, whose scrollbar macOS does not draw until something
#         moves. That is defect V1 exactly, and it is why recheck V1 measures VISIBILITY and
#         the box's own scrollHeight rather than reachability. 160 is chosen against the
#         MEASURED expanded face (224px at 1680x1000, eight links in two columns): high enough
#         that the box, the head, the expander and all eight links are still rendered, low
#         enough that they no longer fit. Two milder mutants were tried first and stayed GREEN,
#         which is worth recording because each looked like an inverse and was not: one column
#         instead of two (eight links stacked still fit 440px), and a 240px cap (the expanded
#         face is 224px, so it still fit).
#   v2    `.filter-chip-remove` loses its 44px hit area (24px, which still clears WCAG 2.5.8
#         and still dismisses). The control is on screen and it works; it is merely below the
#         size decision-28 asks for. recheck V2 asserts >=44px, so it must catch that alone.
#   fold  `.map-canvas` goes back to `min(52vh, 560px)` + the second 16px margin — the exact
#         geometry probe-fold.mjs was written to compare against. The Objektliste's heading
#         then lands at y=964 of a 1000px viewport and no building row is on the fold.
#   f3    the LIGHT theme's `--state-unres` goes back to `oklch(0.62 0.11 75)` — the value
#         that shipped at 4.34:1 and passed only because two audits disagreed about its tier.
#         recheck F3 reads the FILE, so no rebuild is needed for this one.
#   f4    lib/filters.ts `toUuid` stops folding case. `isUuid` is `/i`, so an UPPERCASED uuid
#         still validates, still crosses the boundary, and still matches no row — the screen
#         says „unbekannt" about a building that is right there.
#   t175  lib/period.ts `isPartElapsed` returns false. Every number on /pl/ and /analytics/ is
#         unchanged; the only thing that disappears is the SENTENCE saying how much of the
#         period has not happened, which is what TASK-175 shipped.
#   t176  app/payroll/page.tsx's `excludedCount` gains a phantom `+ 1` with no shift behind
#         it. RE-POINTED: the mutant this ID originally named (drop `+ noRateLines.length`,
#         restoring `excludedShifts` alone) is now dead code to even write — decision-41
#         deleted `noRateLines` outright, so "restore the pre-fix line" and "the current
#         line" are the same string, and B4 caught fix-mutants aborting on the missing site.
#         What survives from the original bug (RECON B4, TASK-176) is the CLASS of defect:
#         a number on the screen that the sub-line's WORDS do not actually back. Proven by
#         hand first: the pre-existing check-money.mjs assertion —
#         `/Schicht/.test(excluded.sub) || excluded.v === "0"` — stayed GREEN under this
#         exact mutant, because "Keine Schicht offen oder unbestätigt" (the zero-case
#         sentence) contains the word "Schicht" regardless of the count next to it. So
#         check-money.mjs A2 gained an independent SQL oracle for the count itself (commit
#         message has the detail) and THAT is what this mutant now exercises.
#   t177  components/WorkerPanel.tsx puts the cross-links back UNDER the ten-row history.
#         Nothing is deleted; the links are merely second, which is the state check-reach
#         measured as 0 of 3 reachable.
#   t178  components/Objektliste.tsx drops the `<Link>` from the day-zero empty state. The
#         sentence survives; only the route to satisfying it is gone.
#   t179  globals.css stops showing the ≤767px „Einstellungen" toggle, so the three header
#         controls sit in the header again and hold the top of a 390px screen.
#
# Every mutant is restored in an EXIT trap and the run ends by asserting `git status
# --porcelain web/` is empty. A mutant left on disk is worse than no mutation test, because
# the next run measures it and believes it.
set -u
cd "$(dirname "$0")/.."

BASE="${DEMO_BASE:-http://127.0.0.1:8080}"
case "$(printf '%s' "$BASE" | sed 's|https\{0,1\}://||; s|[:/].*||')" in
  127.0.0.1|localhost) ;;
  *) echo "fix-mutants: loopback only."; exit 1 ;;
esac

MAPS_KEY="${NEXT_PUBLIC_GOOGLE_MAPS_KEY:-}"
if [ -z "$MAPS_KEY" ]; then
  echo "fix-mutants: NEXT_PUBLIC_GOOGLE_MAPS_KEY is empty — the info box and the pins need a map."
  exit 1
fi

CSS=web/app/globals.css
FILTERS=web/lib/filters.ts
PERIOD=web/lib/period.ts
PAYROLL=web/app/payroll/page.tsx
PANEL=web/components/WorkerPanel.tsx
LISTE=web/components/Objektliste.tsx
LOG=/tmp/fix-mutants
mkdir -p "$LOG"

restore() {
  git checkout -- "$CSS" "$FILTERS" "$PERIOD" "$PAYROLL" "$PANEL" "$LISTE" 2>/dev/null
}
rebuild() {
  ( cd web && NEXT_PUBLIC_GOOGLE_MAPS_KEY="$MAPS_KEY" NEXT_PUBLIC_API_BASE_URL="" \
      NEXT_PUBLIC_DEFAULT_LOCALE=de pnpm build ) >/dev/null 2>&1
}
cleanup() { restore; echo "  … rebuilding the fixed tree"; rebuild; }
trap cleanup EXIT

fails=0
WANTED="${*:-}"
selected() {
  [ -z "$WANTED" ] && return 0
  case " $WANTED " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# mutate <python-heredoc-on-stdin> — asserts the site exists, so a moved fix is loud.
apply() { python3 - "$@"; }

# run <id> <label> <needs-build> <command…>
#
# A NON-ZERO EXIT IS NOT ENOUGH, and this is the whole reason this function is not two lines.
# demo/check-reach.mjs died twice on a hung CDP session („Detected unsettled top-level await")
# with EVERY assertion it had reached still green. Exit 1, no FAIL line, and the first spelling
# of this function recorded both of those as „the negative case fires", which is the exact
# vacuous pass this whole file exists to rule out. So a mutant is only CAUGHT when the log
# carries at least one FAIL line, and a run that exits non-zero without one is INCONCLUSIVE,
# retried once, and counted as a problem if it stays that way.
run() {
  id=$1; label=$2; build=$3; shift 3
  if [ "$build" = build ]; then
    rebuild || { echo "  FAIL $id: the mutant did not build"; fails=$((fails + 1)); restore; return; }
  fi
  attempt=1
  while [ "$attempt" -le 2 ]; do
    "$@" > "$LOG/$id.log" 2>&1
    rc=$?
    caught=$(grep -cE '^ +FAIL' "$LOG/$id.log")
    if [ "$rc" -eq 0 ]; then
      echo "  FAIL $id is GREEN with the fix reverted — $label does not test it"
      fails=$((fails + 1))
      break
    elif [ "$caught" -gt 0 ]; then
      echo "  ok   $id goes RED without the fix ($caught failed assertion(s)):"
      grep -E '^ +FAIL' "$LOG/$id.log" | head -4 | sed 's/^/       /'
      break
    elif [ "$attempt" -eq 1 ]; then
      echo "  ·    $id exited $rc with no FAIL line (a crash, not a verdict) — retrying once"
      attempt=2
    else
      echo "  FAIL $id: exit $rc twice with no failed assertion — INCONCLUSIVE, not caught"
      tail -3 "$LOG/$id.log" | sed 's/^/       /'
      fails=$((fails + 1))
      break
    fi
  done
  restore
}

# --- v1 -------------------------------------------------------------------------------
if selected v1; then
echo "=== MUTANT v1 · the info box is capped too short for the links it hides ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "  max-height: min(52vh, 440px, var(--map-info-max, 440px));"
new = "  max-height: min(52vh, 160px, var(--map-info-max, 160px));"
assert old in s, 'v1 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run v1 "recheck V1" build env DEMO_BASE="$BASE" RECHECK_ONLY=v1 node demo/recheck.mjs
fi

# --- v2 -------------------------------------------------------------------------------
if selected v2; then
echo ""
echo "=== MUTANT v2 · the chip's dismiss control drops below 44px ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """.filter-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;"""
new = """.filter-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;"""
assert old in s, 'v2 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run v2 "recheck V2" build env DEMO_BASE="$BASE" RECHECK_ONLY=v2 node demo/recheck.mjs
fi

# --- fold -----------------------------------------------------------------------------
if selected fold; then
echo ""
echo "=== MUTANT fold · the map canvas goes back to min(52vh, 560px) ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """.map-canvas {
  height: min(36vh, 400px);
  width: 100%;"""
new = """.map-canvas {
  height: min(52vh, 560px);
  width: 100%;"""
assert old in s, 'fold site not found — the fix moved, update this script'
s = s.replace(old, new, 1)
old2 = """     fold for nothing. */
  margin-bottom: 0;"""
new2 = """     fold for nothing. */
  margin-bottom: 16px;"""
assert old2 in s, 'fold margin site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old2, new2, 1))
PY
[ $? -eq 0 ] || exit 1
run fold "recheck FOLD" build env DEMO_BASE="$BASE" RECHECK_ONLY=fold node demo/recheck.mjs
fi

# --- f3 -------------------------------------------------------------------------------
# No rebuild: recheck F3 reads the STYLESHEET, on purpose, so a deleted token cannot be
# answered from a page that inherited it.
if selected f3; then
echo ""
echo "=== MUTANT f3 · the light theme's --state-unres goes back to 4.34:1 ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "  --state-unres: oklch(0.55 0.11 75);"
new = "  --state-unres: oklch(0.62 0.11 75);"
assert old in s, 'f3 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run f3 "recheck F3" nobuild env DEMO_BASE="$BASE" RECHECK_ONLY=f3 node demo/recheck.mjs
fi

# --- f4 -------------------------------------------------------------------------------
if selected f4; then
echo ""
echo "=== MUTANT f4 · toUuid stops folding case ==="
apply "$FILTERS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """  if (value === null || !isUuid(value)) return null
  return value.toLowerCase()"""
new = """  if (value === null || !isUuid(value)) return null
  return value"""
assert old in s, 'f4 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run f4 "recheck F4" build env DEMO_BASE="$BASE" RECHECK_ONLY=f4 node demo/recheck.mjs
fi

# --- t175 -----------------------------------------------------------------------------
if selected t175; then
echo ""
echo "=== MUTANT t175 · a running period stops saying it is running ==="
apply "$PERIOD" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """export function isPartElapsed(range: PeriodRange, now: Date): boolean {
  return range.to !== null && new Date(range.to).getTime() > now.getTime()
}"""
new = """export function isPartElapsed(range: PeriodRange, now: Date): boolean {
  void range
  void now
  return false
}"""
assert old in s, 't175 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run t175 "check-money A1" build env DEMO_BASE="$BASE" node demo/check-money.mjs
fi

# --- t176 -----------------------------------------------------------------------------
if selected t176; then
echo ""
echo "=== MUTANT t176 · „Nicht gezählt“ gains a phantom +1 no shift backs ==="
apply "$PAYROLL" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = "  const excludedCount = excludedShifts\n"
new = "  const excludedCount = excludedShifts + 1\n"
assert s.count(old) == 1, 't176 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run t176 "check-money A2" build env DEMO_BASE="$BASE" node demo/check-money.mjs
fi

# --- t177 -----------------------------------------------------------------------------
if selected t177; then
echo ""
echo "=== MUTANT t177 · the worker panel's links go back under the history ==="
apply "$PANEL" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
links = s[s.index("      <h3>{t('panelLinksHeading')}</h3>"):s.index("      <h3>{t('panelRecentHeading'")]
assert links.strip().endswith('</ul>'), 't177 links block not found — the fix moved'
rest = s.replace(links, '', 1)
at = rest.index('    </Drawer>')
open(p, 'w', encoding='utf-8').write(rest[:at] + links + rest[at:])
PY
[ $? -eq 0 ] || exit 1
run t177 "check-reach B1" build env DEMO_BASE="$BASE" node demo/check-reach.mjs
fi

# --- t178 -----------------------------------------------------------------------------
if selected t178; then
echo ""
echo "=== MUTANT t178 · day zero loses the action it names ==="
apply "$LISTE" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """        {t('objectsEmpty')} <Link href="/locations/">{t('objectsEmptyLink')}</Link>"""
new = """        {t('objectsEmpty')}"""
assert old in s, 't178 site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
PY
[ $? -eq 0 ] || exit 1
run t178 "check-reach B2" build env DEMO_BASE="$BASE" node demo/check-reach.mjs
fi

# --- t179 -----------------------------------------------------------------------------
if selected t179; then
echo ""
echo "=== MUTANT t179 · the phone's settings toggle disappears, so the three controls stay in the header ==="
apply "$CSS" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding='utf-8').read()
old = """  .header-tools .header-tools-toggle {
    display: inline-flex;
  }"""
new = """  .header-tools .header-tools-toggle {
    display: none;
  }"""
assert old in s, 't179 site not found — the fix moved, update this script'
s = s.replace(old, new, 1)
old2 = """  .header-actions[data-open="no"] {
    display: none;
  }"""
new2 = """  .header-actions[data-open="no"] {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s3);
  }"""
assert old2 in s, 't179 second site not found — the fix moved, update this script'
open(p, 'w', encoding='utf-8').write(s.replace(old2, new2, 1))
PY
[ $? -eq 0 ] || exit 1
run t179 "check-reach B3" build env DEMO_BASE="$BASE" node demo/check-reach.mjs
fi

# --------------------------------------------------------------------------------------
cleanup
trap - EXIT

# THE FILES THIS SCRIPT MUTATES, and only those. `git status --porcelain web/` was the first
# spelling and it is wrong on a tree with a concurrent editor: on 19 Aug 2026 it reported a
# mutant left behind when the dirty file was web/lib/tag.ts, which this script never touches.
dirty=$(git status --porcelain -- "$CSS" "$FILTERS" "$PERIOD" "$PAYROLL" "$PANEL" "$LISTE")
if [ -n "$dirty" ]; then
  echo ""
  echo "  FAIL a mutated file is still on disk:"
  echo "$dirty" | sed 's/^/       /'
  fails=$((fails + 1))
else
  echo ""
  echo "  ok   web/ is clean again and rebuilt from the fixed source"
fi

echo ""
if [ "$fails" -eq 0 ]; then
  echo "fix-mutants: every negative case fires."
else
  echo "fix-mutants: $fails PROBLEM(S)."
fi
exit "$fails"
