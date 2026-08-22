#!/usr/bin/env bash
# THE TEST SCAN CANNOT OPEN A SHIFT — STRUCTURALLY, NOT BY POLICY.
#
#     cd android && ./checks/verify-no-shift-check.sh
#     MUTANT=tapinbox    ./checks/verify-no-shift-check.sh    # must go RED
#     MUTANT=actionview  ./checks/verify-no-shift-check.sh    # must go RED
#     MUTANT=workerapi   ./checks/verify-no-shift-check.sh    # must go RED
#
# WHY THIS FILE EXISTS. nfc/VerifyZoneActivity.kt (decision-47) reads an NFC tag and calls
# the server, on purpose, in a screen that looks almost exactly like ScanActivity's — same
# reader-mode setup, same "read a URI, fall back to a serial match" shape. The one property
# that makes it safe to have a second screen that reads tags is that THIS one cannot reach
# the path that opens a shift: no ACTION_VIEW intent, no TapInbox, no reference to the
# worker-session Api (`app.api`) — only `app.operatorApi`, which carries `ts_operator`, and
# no route that touches a shift accepts that cookie (decision-45). That is a property of the
# WIRING, and this checks it against the source that does the wiring — not a comment's
# promise about it.
#
# THE NEGATIVE CASE IS SEEDED IN MEMORY, NEVER ON DISK. Each MUTANT appends the exact token
# this check forbids to a COPY of the file's text held in a shell variable and reruns the
# same test against it. The file on disk is never touched, so an interrupted run cannot
# leave the regression it was demonstrating committed — same discipline release-artefact.sh
# documents for why nothing here pipes into grep either (see its own header).
set -uo pipefail

cd "$(dirname "$0")/.."     # android/

NFC=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc
VERIFY="$NFC/VerifyZoneActivity.kt"
SCAN="$NFC/ScanActivity.kt"
VIEWMODEL=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/ui/TimeSheetViewModel.kt
DEBUG_SIM=app/src/debug/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifySimulation.kt
RELEASE_SIM=app/src/release/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifySimulation.kt
MUTANT="${MUTANT:-}"

fail=0
ok()  { printf '  ok    %s\n' "$1"; }

for f in "$VERIFY" "$SCAN" "$VIEWMODEL" "$DEBUG_SIM" "$RELEASE_SIM"; do
  [ -f "$f" ] || { echo "verify-no-shift-check: missing $f" >&2; exit 127; }
done

verify_src="$(/bin/cat "$VERIFY")"
scan_src="$(/bin/cat "$SCAN")"
viewmodel_src="$(/bin/cat "$VIEWMODEL")"
debug_sim_src="$(/bin/cat "$DEBUG_SIM")"
release_sim_src="$(/bin/cat "$RELEASE_SIM")"

# The mutants edit the STRINGS this run reads, never the files on disk.
case "$MUTANT" in
  tapinbox)   verify_src="$verify_src"$'\n// mutant: import io.github.qwadratic.nfctimesheets.core.TapInbox' ;;
  actionview) verify_src="$verify_src"$'\n// mutant: startActivity(Intent(Intent.ACTION_VIEW, target))' ;;
  workerapi)  verify_src="$verify_src"$'\n// mutant: app.api.openShift(clientUuid, placeUuid, startTime)' ;;
  "")         ;;
  *)          echo "verify-no-shift-check: unknown MUTANT=$MUTANT" >&2; exit 2 ;;
esac
[ -n "$MUTANT" ] && echo "verify-no-shift-check: MUTANT=$MUTANT — the line below MUST go red"

has() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

echo "verify-no-shift-check: proving VerifyZoneActivity cannot reach the shift path"

# ---- the mechanism itself, proven before anything is concluded from it ------------------
# ScanActivity legitimately fires ACTION_VIEW to converge into the ordinary tap path, and
# TimeSheetViewModel (MainActivity's handoff) legitimately names TapInbox. If this search
# cannot find either real, known usage, the search itself is broken and nothing below means
# anything — the exact control release-artefact.sh applies to "writeNdefMessage".
if has "ACTION_VIEW" "$scan_src"; then
  ok "the search works: ScanActivity.kt (which DOES open a shift) contains ACTION_VIEW"
else
  echo "FAIL: 'ACTION_VIEW' not found in ScanActivity.kt — the search is broken" >&2
  fail=1
fi
if has "TapInbox" "$viewmodel_src"; then
  ok "the search works: TimeSheetViewModel.kt (which DOES open a shift) contains TapInbox"
else
  echo "FAIL: 'TapInbox' not found in TimeSheetViewModel.kt — the search is broken" >&2
  fail=1
fi
if has "operatorApi" "$verify_src"; then
  ok "the search works: VerifyZoneActivity.kt actually calls through operatorApi"
else
  echo "FAIL: 'operatorApi' not found in VerifyZoneActivity.kt — the search is broken" >&2
  fail=1
fi

# ---- the forbidden tokens ----------------------------------------------------------------
check_clean() {
  local path="$1" content="$2"
  if has "TapInbox" "$content"; then
    echo "FAIL: 'TapInbox' found in $path — this screen must never converge into a clock-in" >&2
    fail=1
  fi
  if has "ACTION_VIEW" "$content"; then
    echo "FAIL: 'ACTION_VIEW' found in $path — this screen must never start the tap intent" >&2
    fail=1
  fi
  if has "app.api" "$content"; then
    echo "FAIL: 'app.api' (the WORKER session) found in $path — this screen may only ever" >&2
    echo "      speak through app.operatorApi" >&2
    fail=1
  fi
}

check_clean "$VERIFY" "$verify_src"
check_clean "$DEBUG_SIM" "$debug_sim_src"
check_clean "$RELEASE_SIM" "$release_sim_src"
[ "$fail" -eq 0 ] && [ -z "$MUTANT" ] && \
  ok "no TapInbox / ACTION_VIEW / app.api in the verify screen or its simulator"

echo
if [ "$fail" -eq 0 ]; then
  [ -n "$MUTANT" ] && { echo "verify-no-shift-check: MUTANT=$MUTANT stayed GREEN — the check is vacuous"; exit 1; }
  echo "verify-no-shift-check: OK"
  exit 0
fi
if [ -n "$MUTANT" ]; then
  echo "verify-no-shift-check: $fail red under MUTANT=$MUTANT, as required"
  exit 0
fi
echo "verify-no-shift-check: $fail FAILED"
exit 1
