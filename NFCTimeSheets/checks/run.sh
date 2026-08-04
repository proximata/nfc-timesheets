#!/usr/bin/env bash
# Runs every NFCTimeSheets/checks/*.swift on a plain Mac. No Xcode project, no simulator,
# no device, no test framework — that is the point: everything covered here is logic that
# would otherwise only be discovered at a door, in the dark, with a tag in one hand.
#
#     cd NFCTimeSheets && ./checks/run.sh
#
# Each check is a top-level Swift script that gets `cat`-ed together with the production
# files it exercises and run by `swift`. Those files are Foundation-only ON PURPOSE — that
# constraint is why TagLink.swift, TapInbox.swift, MigrationCore.swift, Scrub.swift,
# Materials.swift and ShiftSignal.swift look the way they do.
#
# The recipe for each check is also written at the top of the check itself, so a single one
# can still be run by hand while working on it. This file exists so nobody has to remember
# six of them, and so "the checks pass" means the same thing to every person who says it.
#
# WHAT THIS CANNOT PROVE, and nothing on a Mac can: that a physical tag fires the universal
# link, that a Live Activity survives a reboot, that a locked screen is legible at 200%
# Dynamic Type. Those need a phone. See docs/LIVE-ACTIVITY-SETUP.md § "Verify on hardware".
set -uo pipefail

cd "$(dirname "$0")/.."     # NFCTimeSheets/

command -v swift >/dev/null 2>&1 || {
  echo "checks: swift not found. Install Xcode or the Command Line Tools." >&2
  exit 127
}

SRC=NFCTimeSheets
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

failed=0

# name : production files it needs (in order), the check itself is checks/<name>.swift
run() {
  local name="$1"; shift
  local out="$TMP/$name.swift"
  # shellcheck disable=SC2068
  cat $@ "checks/$name.swift" > "$out"
  if swift "$out"; then :; else failed=1; fi
}

run tag-link-check      "$SRC/Branding.swift" "$SRC/TagLink.swift" "$SRC/API.swift"
run tap-inbox-check     "$SRC/TapInbox.swift"
run migration-check     "$SRC/Branding.swift" "$SRC/TagLink.swift" "$SRC/API.swift" "$SRC/MigrationCore.swift"
run scrub-check         "$SRC/Scrub.swift"
run materials-check     "$SRC/Branding.swift" "$SRC/TagLink.swift" "$SRC/API.swift" "$SRC/Materials.swift"
run shift-signal-check  "$SRC/ShiftSignal.swift"

# Reads Localizable.xcstrings off disk rather than being cat-ed together with source.
if swift checks/localisation-check.swift; then :; else failed=1; fi

if [ "$failed" -ne 0 ]; then
  echo "checks: FAILED" >&2
  exit 1
fi
echo "checks: OK"
