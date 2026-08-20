#!/usr/bin/env bash
# THE MOCK IS NOT IN THE SHIPPED APP — checked against the .apk, not against the source.
#
#     cd android && ./checks/release-artefact.sh [path/to/app-release.apk]
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
# and the release build's writeSimulations() has no scenarios to return.
#
# THE NEGATIVE CASE IS BUILT IN: it runs the same greps against the DEBUG apk, where they
# MUST hit. A grep that finds nothing in both is not a check, it is a typo.
set -euo pipefail

cd "$(dirname "$0")/.."     # android/

RELEASE="${1:-app/build/outputs/apk/release/app-release.apk}"
DEBUG="${2:-app/build/outputs/apk/debug/app-debug.apk}"

for apk in "$RELEASE" "$DEBUG"; do
  [ -f "$apk" ] || { echo "release-artefact: missing $apk — build both variants first" >&2; exit 127; }
done

# Distinctive strings that exist ONLY in the debug simulator. Chosen because each one is a
# thing the operator would SEE if the simulator ever shipped.
NEEDLES=(
  "SIMULATED"
  "verify fails: one flipped byte in the uuid"
  "verify fails: the card reads back empty"
  "the foreign Ultralight at HOIV"
  "runSimulation"
)

dexstrings() {
  # Every classes*.dex, concatenated. `strings` over the dex catches both the string pool
  # and the member/type names, which is what makes "runSimulation" a meaningful needle.
  unzip -p "$1" 'classes*.dex' 2>/dev/null | strings -n 6
}

RELEASE_STRINGS=$(dexstrings "$RELEASE")
DEBUG_STRINGS=$(dexstrings "$DEBUG")

fail=0
for needle in "${NEEDLES[@]}"; do
  # RED FIRST: the debug apk must contain it, or the needle is wrong and the release
  # result below is meaningless.
  if ! printf '%s' "$DEBUG_STRINGS" | grep -qF -- "$needle"; then
    echo "FAIL: '$needle' is not in the DEBUG apk either — this needle proves nothing" >&2
    fail=1
    continue
  fi
  if printf '%s' "$RELEASE_STRINGS" | grep -qF -- "$needle"; then
    echo "FAIL: '$needle' IS PRESENT in the release apk — the simulator shipped" >&2
    fail=1
  else
    echo "  ok  present in debug, absent from release: '$needle'"
  fi
done

# The class itself. R8 renames, so the type name is checked by its source file attribute,
# which survives into the dex unless the build strips it.
if unzip -p "$RELEASE" 'classes*.dex' | strings -n 6 | grep -q 'WriteSimulation.kt'; then
  # Present is FINE and expected: src/release/ has a file of that name. What matters is
  # that its scenarios are not there — covered by the needles above.
  echo "  ok  WriteSimulation.kt is present in release (the src/release/ stub), without any scenario"
fi

if [ "$fail" -ne 0 ]; then
  echo "release-artefact: FAILED" >&2
  exit 1
fi
echo "release-artefact: OK"
