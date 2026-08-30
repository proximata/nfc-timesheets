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
# decision-57: OFF must stay OFF. See the check's header for why the default is the feature.
run flags-check         "$SRC/FeatureFlags.swift"
# decision-62: the cache-generation marker. Fires once per build change, never on a fresh
# install, never twice - see the check's header for the two silent failures it pins.
run app-update-check    "$SRC/AppUpdate.swift"
# decision-49: the byte encoder and the overwrite guard, safety-critical - wrong bytes
# ruin a physical card mounted to a building. See each check's own header for the exact
# TASK-220 regression it reproduces before going green.
run ndef-tag-check      "$SRC/Branding.swift" "$SRC/TagLink.swift" "$SRC/NdefTag.swift"
run write-guard-check   "$SRC/Branding.swift" "$SRC/TagLink.swift" "$SRC/NdefTag.swift" "$SRC/WriteGuard.swift"
# The write screen's step machine: exactly one panel, and a SECOND card in the same session
# starts clean. See the check's header for the three-panels-at-once bug it reproduces.
run write-tag-step-check "$SRC/WriteTagStep.swift"
# TASK-321/decision-63: five digits, no dash, no letter aliasing - and the same shape the
# SERVER mints, read out of server/lib/enrolment.js rather than copied. Android's
# core-check.kt has the twin of this; the two must never disagree.
run enrolment-code-check "$SRC/EnrolmentCode.swift"

# Reads Localizable.xcstrings off disk rather than being cat-ed together with source.
if swift checks/localisation-check.swift; then :; else failed=1; fi

# TASK-276: the operator gate must read the ts_operator cookie, never a UserDefaults flag
# that no sign-out clears. Reads the sources off disk - see the check's own header for why
# it cannot be cat-ed together with them.
if swift checks/operator-gate-check.swift; then :; else failed=1; fi

# decision-59: `sms_login` off must remove the SMS door from BOTH iOS sign-in paths, and
# the capability read must fail CLOSED. Reads the sources off disk, same reason as above.
if swift checks/sms-gate-check.swift; then :; else failed=1; fi

# decision-49: reads NFCTimeSheets.entitlements off disk — never writes it (owner-only file).
# Catches NDEF sneaking back into the array (App Store 90778) whether Xcode, a human or an
# agent put it there. Green with the capability off entirely.
if swift checks/entitlement-format-check.swift; then :; else failed=1; fi

if [ "$failed" -ne 0 ]; then
  echo "checks: FAILED" >&2
  exit 1
fi
echo "checks: OK"
