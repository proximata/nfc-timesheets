#!/usr/bin/env bash
# THE MOCK IS NOT IN THE SHIPPED APP — checked against the .apk, not against the source.
#
#     cd android && ./checks/release-artefact.sh [path/to/app-release.apk] [path/to/app-debug.apk]
#
# WHY THIS IS NOT A CODE REVIEW. `src/debug/.../WriteSimulation.kt` can claim a tag was
# written when no tag was present. That is exactly what an emulator needs and exactly what
# must never reach a phone: an operator shown "written and verified" for a card that does
# not exist would mount nothing, report a tag id to the office, and the failure would only
# surface weeks later as a building whose cleaners cannot clock in. Reading the source and
# concluding "it is in the debug source set" is a claim about the build system. This is a
# claim about the bytes that get installed.
#
# WHAT IT PROVES: the simulator's own strings and members do not appear in the release dex,
# and nothing in either dex asks to lock a tag.
#
# THE NEGATIVE CASE IS BUILT IN, TWICE: every simulator needle must be FOUND in the DEBUG
# apk, and `writeNdefMessage` — a call the app really does make — must be found in BOTH. A
# search that finds nothing anywhere is not a search, it is a typo.
#
# ---------------------------------------------------------------------------------------
# WHY THE STRINGS GO TO FILES AND NOTHING IS PIPED INTO grep. Read this before "tidying" it.
#
# This script used to hold the dex strings in a shell variable and test them with
#
#     printf '%s' "$DEBUG_STRINGS" | grep -qF -- "$needle"
#
# under `set -o pipefail`. `grep -q` exits the instant it matches. The producer is still
# writing ~8.6 MB into the pipe, so it takes SIGPIPE and dies 141, and pipefail promotes
# that 141 to the status of the whole pipeline. The result is a test that reports FAILURE
# EXACTLY WHEN THE NEEDLE IS FOUND — verified: `grep -c` returns 1 match on the same input
# where `grep -q` yields pipeline status 141.
#
# On the debug arm that showed up as five noisy "this needle proves nothing" failures. On
# the RELEASE arm it was silent and the wrong way round: had the simulator actually shipped,
# grep would have matched, printf would have SIGPIPE'd, the `if` would have been false, and
# this script would have printed "ok absent from release" and exited 0. The one check
# standing between an operator and a mock that fakes written cards could not fail.
#
# So: strings are written to files, and grep reads the FILE. No pipeline, no SIGPIPE, and
# the exit status is grep's own answer.
# ---------------------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."     # android/

RELEASE="${1:-app/build/outputs/apk/release/app-release.apk}"
DEBUG="${2:-app/build/outputs/apk/debug/app-debug.apk}"

for apk in "$RELEASE" "$DEBUG"; do
  [ -f "$apk" ] || { echo "release-artefact: missing $apk — build both variants first" >&2; exit 127; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Every classes*.dex, concatenated. `strings` over the dex catches both the string pool and
# the member/type names, which is what makes "runSimulation" and "makeReadOnly" meaningful
# needles: a method the app calls appears in the dex by name even when nothing prints it.
dexstrings() {
  unzip -p "$1" 'classes*.dex' 2>/dev/null | strings -n 6 > "$2"
}

dexstrings "$RELEASE" "$WORK/release.txt"
dexstrings "$DEBUG" "$WORK/debug.txt"

for f in release debug; do
  [ -s "$WORK/$f.txt" ] || { echo "FAIL: no dex strings extracted from the $f apk at all" >&2; exit 1; }
done

fail=0

# `grep -q` against a FILE. Never a pipeline — see the header.
has() { grep -qF -- "$2" "$WORK/$1.txt"; }

# ---- the mechanism itself, proven before anything is concluded from it ------------------
# `writeNdefMessage` is a call TagWriter really makes, in both variants. If this is not
# found, the extraction or the search is broken and every "absent" below means nothing.
for variant in release debug; do
  if has "$variant" "writeNdefMessage"; then
    echo "  ok  the search works: 'writeNdefMessage' found in the $variant dex"
  else
    echo "FAIL: 'writeNdefMessage' not found in the $variant dex — the SEARCH is broken," >&2
    echo "      so nothing this script reports as 'absent' can be believed" >&2
    fail=1
  fi
done

# ---- the simulator must not have shipped -----------------------------------------------
# Distinctive strings that exist ONLY in the debug simulator. Chosen because each one is a
# thing the operator would SEE if the simulator ever shipped.
#
# THE FIRST FOUR ARE THE ONES THAT CATCH. Verified by seeding it: src/debug's simulator was
# copied over the src/release stub and a release apk built. Those four fired. "runSimulation"
# DID NOT — R8 renames the function, so its name is not in the release dex whether the
# simulator shipped or not. It stays in the list as a debug-side control (it must be found
# in the debug dex, which proves member names are reachable by this search at all), but it
# is not load-bearing for the release verdict and must never be the only needle left.
#
# THE LAST TWO ARE TASK-220's. The simulator now also pretends a card ALREADY CARRIES one
# of our ids, which is the only way to see the overwrite refusal on an emulator. Shipped,
# it would be worse than the others: it puts a real location uuid on the operator's screen
# with no card present, i.e. it fakes the exact fact the guard exists to establish.
NEEDLES=(
  "SIMULATED"
  "verify fails: one flipped byte in the uuid"
  "verify fails: the card reads back empty"
  "the foreign Ultralight at HOIV"
  "a MOUNTED card"
  "holds somebody else's URL"
  "runSimulation"
  # decision-54 §2's zone step. Shipped, it would put a building list nobody fetched and a
  # "zone created" sentence on the screen of an operator whose zone was never created.
  "Zone MIT Gebaeude"
  "SIMULATED: Stiegengasse 3"
)

# decision-47's TEST SCAN gets the identical treatment (nfc/VerifySimulation.kt): a debug-
# only mock lets VerifyZoneActivity be exercised on an emulator, where NFC does not exist,
# and it must not be the thing an operator sees telling them a zone was proved when no card
# was ever read. "verifyTapSimulations" is the debug-side control, same reasoning as
# "runSimulation" above: R8 renames it, so it is not load-bearing for the release verdict by
# itself — the distinctive scenario strings are.
VERIFY_NEEDLES=(
  "sollte freischalten"
  "kein Zonen-Tag"
  "eine leere oder unlesbare Karte"
  "verifyTapSimulations"
  # decision-54 §§3/7's bind form and zone page. The worker names are the sharpest of these:
  # a shipped fixture would show an operator people and hours at a door where nobody worked.
  "SIMULATED: Zone ohne Gebaeude"
  "SIMULATED: Anna B."
)

# decision-56's manual pair (ui/ManualSimulation.kt). Shipped, this one would be the worst
# of the three: it answers POST /shifts/open and /shifts/close WITHOUT asking the server, so
# a worker would be shown a running clock — or a finished shift — for hours that exist
# nowhere but on their screen, and would find out at month end. "manualOpenSimulations" is
# the debug-side control only (R8 renames it); the labels are what is load-bearing.
MANUAL_NEEDLES=(
  "SIMULATED manual start: the server accepts it"
  "SIMULATED manual start: 422 the zone is not verified"
  "SIMULATED manual start: 409 a shift is already open"
  "SIMULATED manual stop: closed and flagged"
  "manualOpenSimulations"
)

for needle in "${NEEDLES[@]}" "${VERIFY_NEEDLES[@]}" "${MANUAL_NEEDLES[@]}"; do
  # RED FIRST: the debug apk must contain it, or the needle is wrong and the release
  # result below is meaningless.
  if ! has debug "$needle"; then
    echo "FAIL: '$needle' is not in the DEBUG apk either — this needle proves nothing" >&2
    fail=1
    continue
  fi
  if has release "$needle"; then
    echo "FAIL: '$needle' IS PRESENT in the release apk — the simulator shipped" >&2
    fail=1
  else
    echo "  ok  present in debug, absent from release: '$needle'"
  fi
done

# ---- nothing asks to lock a tag, in either build ----------------------------------------
# Tags stay UNLOCKED (decision-15): locking is irreversible, and it buys nothing anyway
# since a serial and a URL are both public and neither authenticates anybody — the worker
# comes from the session. checks/tag-writer-check.kt proves no path it drives reaches
# makeReadOnly(); this proves the call is not in the shipped dex at all, including the
# screens that check cannot drive. The control above is what makes an "absent" here mean
# something: platform method names DO appear in this dex, so a missing one is a real
# absence and not a search that finds nothing.
for forbidden in "makeReadOnly" "canMakeReadOnly"; do
  for variant in release debug; do
    if has "$variant" "$forbidden"; then
      echo "FAIL: '$forbidden' is in the $variant dex — tags stay unlocked (decision-15)," >&2
      echo "      and locking a client's card cannot be undone" >&2
      fail=1
    fi
  done
done
[ "$fail" -eq 0 ] && echo "  ok  no makeReadOnly/canMakeReadOnly in either dex (decision-15)"

# The class itself. R8 renames, so the type name is checked by its source file attribute,
# which survives into the dex unless the build strips it.
if has release "WriteSimulation.kt"; then
  # Present is FINE and expected: src/release/ has a file of that name. What matters is
  # that its scenarios are not there — covered by the needles above.
  echo "  ok  WriteSimulation.kt is present in release (the src/release/ stub), without any scenario"
fi
if has release "VerifySimulation.kt"; then
  echo "  ok  VerifySimulation.kt is present in release (the src/release/ stub), without any scenario"
fi
if has release "ManualSimulation.kt"; then
  echo "  ok  ManualSimulation.kt is present in release (the src/release/ stub), without any scenario"
fi

if [ "$fail" -ne 0 ]; then
  echo "release-artefact: FAILED" >&2
  exit 1
fi
echo "release-artefact: OK"
