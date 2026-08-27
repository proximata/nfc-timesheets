#!/usr/bin/env bash
# THE READER IS DISARMED WHILE A WRITTEN CARD IS BEING NAMED (TASK-301, decision-58 §3).
#
#     cd android && ./checks/reader-armed-check.sh
#     MUTANT=nosuppress ./checks/reader-armed-check.sh   # must go RED
#     MUTANT=order      ./checks/reader-armed-check.sh   # must go RED
#     MUTANT=nodisable  ./checks/reader-armed-check.sh   # must go RED (TASK-303)
#     MUTANT=noreactive ./checks/reader-armed-check.sh   # must go RED (TASK-303)
#
# TASK-303. The first three assertions below all passed on a build where the bug was STILL
# LIVE, because readerWanted() being right buys nothing if nothing ever acts on it going
# false: startReaderMode() read it at one call site, to decide whether to CALL enable, and
# no path anywhere disabled. So this also asserts the ACTUATOR, in two halves that a
# correct-looking readerWanted() cannot fake:
#   1. syncReaderMode() calls disableReaderMode on the not-wanted branch, and no
#      start-only caller survives anywhere in the file;
#   2. a LaunchedEffect re-runs it on every freshStep AND reassignStep change, so the state
#      change and the radio change are one act rather than six call sites and a hope.
#
# WHY. nfc/VerifyZoneActivity.kt imports android.nfc, so readerWanted() cannot be compiled
# into the JVM checks, and NFC hardware does not exist on an emulator — the state this is
# about (freshStep = Reporting/Naming/Submitting/Failed: card ALREADY written and ALREADY
# reported, zone not created yet) is reachable in the field and nowhere else. A stray tap
# there fell through to the ordinary read, re-classified scanStep/outcome away from
# Unreadable, and took FreshCardSection out of the composition with no way back.
#
# So this reads the WIRING, the same way verify-no-shift-check.sh does: the arming clause and
# the suppressing clause must both exist in readerWanted(), and the arming one must come
# FIRST — a `when` is ordered, and the pair inverted is the bug with extra steps.
#
# The negative cases are seeded in memory, never on disk (see verify-no-shift-check.sh).
set -uo pipefail

cd "$(dirname "$0")/.."     # android/

VERIFY=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifyZoneActivity.kt
MUTANT="${MUTANT:-}"

[ -f "$VERIFY" ] || { echo "reader-armed-check: missing $VERIFY" >&2; exit 127; }

ARM='freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true'
SUPPRESS='freshStep !is FreshStep.Idle -> false'
R_ARM='reassignStep is ReassignStep.AwaitingCard || reassignStep is ReassignStep.WriteRefused -> true'
R_SUPPRESS='reassignStep !is ReassignStep.Idle && reassignStep !is ReassignStep.Done -> false'

# The body of readerWanted() only — a match anywhere else in the file proves nothing.
body="$(/usr/bin/awk '/private fun readerWanted\(\): Boolean = when \{/{f=1} f{print} f&&/^    \}$/{exit}' "$VERIFY")"
# ...and the body of syncReaderMode() only, same reason: disableReaderMode exists elsewhere
# in this file (onPause, submitUnbind) and neither is on a write path.
sync="$(/usr/bin/awk '/private fun syncReaderMode\(\) \{/{f=1} f{print} f&&/^    \}$/{exit}' "$VERIFY")"
# The reactive re-sync, anywhere in the file (it lives in setContent).
reactive="$(/usr/bin/grep -F 'LaunchedEffect(freshStep, reassignStep)' "$VERIFY" || true)"
# A start-only caller left behind would be a seventh site drifting from the authority.
stale="$(/usr/bin/grep -n 'startReaderMode()' "$VERIFY" | /usr/bin/grep -v 'WriteTagActivity.startReaderMode' || true)"

case "$MUTANT" in
  nosuppress) body="$(printf '%s\n' "$body" | /usr/bin/grep -v -F "$SUPPRESS")" ;;
  order)      body="$(printf '%s\n' "$body" | /usr/bin/grep -v -F "$ARM")
$ARM" ;;
  # TASK-303's own two: readerWanted() left perfect, the actuator broken — i.e. exactly
  # the tree that shipped as cffe9ca. Both MUST go red or this check is still vacuous.
  nodisable)  sync="$(printf '%s\n' "$sync" | /usr/bin/grep -v -F 'disableReaderMode')" ;;
  noreactive) reactive="" ;;
  "")         ;;
  *)          echo "reader-armed-check: unknown MUTANT=$MUTANT" >&2; exit 2 ;;
esac
[ -n "$MUTANT" ] && echo "reader-armed-check: MUTANT=$MUTANT — this run MUST go red"

fail=0
ok() { printf '  ok    %s\n' "$1"; }

echo "reader-armed-check: reading readerWanted() in VerifyZoneActivity.kt"

# The mechanism, proven before anything is concluded from it.
if [ -z "$body" ]; then
  echo "FAIL: readerWanted() not found — this check's extraction is broken, not the code" >&2
  exit 1
fi
case "$body" in
  *"selectedZone == null -> true"*)
    ok "the extraction works: the scan-first arming clause is inside the extracted body" ;;
  *)
    echo "FAIL: extracted body has no 'selectedZone == null' clause — extraction is broken" >&2
    exit 1 ;;
esac

arm_line=$(printf '%s\n' "$body" | /usr/bin/grep -n -F "$ARM" | head -1 | cut -d: -f1)
sup_line=$(printf '%s\n' "$body" | /usr/bin/grep -n -F "$SUPPRESS" | head -1 | cut -d: -f1)

if [ -n "$arm_line" ]; then
  ok "AwaitingCard/WriteRefused still ARM the reader (the only tap here that writes)"
else
  echo "FAIL: the AwaitingCard/WriteRefused arming clause is gone — the recovery cannot write" >&2
  fail=1
fi
if [ -n "$sup_line" ]; then
  ok "every other freshStep DISARMS it (Reporting/Naming/Submitting/Failed)"
else
  echo "FAIL: no '$SUPPRESS' clause — a tap while the written card is being named strands it" >&2
  fail=1
fi
if [ -n "$arm_line" ] && [ -n "$sup_line" ]; then
  if [ "$arm_line" -lt "$sup_line" ]; then
    ok "the arming clause is ABOVE the suppressing one (when is ordered)"
  else
    echo "FAIL: the suppressing clause comes first — AwaitingCard would never arm" >&2
    fail=1
  fi
fi

# The reassign flow has the identical pair and had the identical hole (TASK-303 AC#2).
r_arm_line=$(printf '%s\n' "$body" | /usr/bin/grep -n -F "$R_ARM" | head -1 | cut -d: -f1)
r_sup_line=$(printf '%s\n' "$body" | /usr/bin/grep -n -F "$R_SUPPRESS" | head -1 | cut -d: -f1)
if [ -n "$r_arm_line" ] && [ -n "$r_sup_line" ] && [ "$r_arm_line" -lt "$r_sup_line" ]; then
  ok "reassign has the same ordered pair (Done stays armed: the screen is on the new zone)"
else
  echo "FAIL: the reassign arming/suppressing pair is missing or inverted" >&2
  fail=1
fi

# ---- THE ACTUATOR (TASK-303). readerWanted() being right is not the fix. ----
echo
echo "reader-armed-check: reading syncReaderMode() — the radio must MOVE, not merely decline"
if [ -z "$sync" ] && [ -z "$MUTANT" ]; then
  echo "FAIL: syncReaderMode() not found — a start-only shape cannot disarm anything" >&2
  exit 1
fi
case "$sync" in
  *"!readerWanted()"*) ok "the extraction works: syncReaderMode() reads readerWanted()" ;;
  *) echo "FAIL: syncReaderMode() does not consult readerWanted() — extraction or code broken" >&2
     fail=1 ;;
esac
case "$sync" in
  *disableReaderMode*)
    ok "the not-wanted branch DISABLES the reader (not just 'return')" ;;
  *)
    echo "FAIL: syncReaderMode() never calls disableReaderMode — a reader armed for" >&2
    echo "      AwaitingCard stays armed through Reporting/Naming/Submitting/Failed" >&2
    fail=1 ;;
esac
case "$sync" in
  *enableReaderMode*) ok "...and it still ARMS (the recovery must be able to write)" ;;
  *) echo "FAIL: syncReaderMode() never enables — no tap on this screen could write" >&2
     fail=1 ;;
esac
if [ -n "$stale" ]; then
  echo "FAIL: a start-only startReaderMode() caller survives — two shapes, one radio:" >&2
  printf '%s\n' "$stale" >&2
  fail=1
else
  ok "no start-only caller left: syncReaderMode() is the single actuator"
fi
if [ -n "$reactive" ]; then
  ok "a LaunchedEffect re-syncs on every freshStep AND reassignStep change"
else
  echo "FAIL: nothing re-runs syncReaderMode() when freshStep/reassignStep changes, so the" >&2
  echo "      radio and the Compose state drift the moment a write completes" >&2
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
  [ -n "$MUTANT" ] && { echo "reader-armed-check: MUTANT=$MUTANT stayed GREEN — the check is vacuous"; exit 1; }
  echo "reader-armed-check: OK"
  exit 0
fi
if [ -n "$MUTANT" ]; then
  echo "reader-armed-check: $fail red under MUTANT=$MUTANT, as required"
  exit 0
fi
echo "reader-armed-check: $fail FAILED"
exit 1
