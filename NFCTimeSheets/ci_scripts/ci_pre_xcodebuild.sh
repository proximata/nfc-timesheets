#!/bin/sh
# ci_pre_xcodebuild.sh — Xcode Cloud custom build script.
#
# INTENTIONALLY NOT EMPTY — the exact opposite of its sibling ci_post_xcodebuild.sh, and for
# the mirror-image reason. That hook cannot do its job because it runs too EARLY (before the
# archive exists). This one works because it runs early: Xcode Cloud invokes
# ci_pre_xcodebuild.sh immediately before the xcodebuild action, and a non-zero exit here
# fails the build without burning a build number on an archive nobody should ship.
# (ci_post_clone.sh would also run before the archive, but it runs before dependency
# resolution too — this belongs as close to the build as the lifecycle allows.)
#
# WHAT IT GATES: NFCTimeSheets/checks/run.sh — the Foundation-only Swift checks (TagLink,
# TapInbox, MigrationCore, Scrub, Materials, ShiftSignal, the decision-49 NDEF byte encoder
# and overwrite guard, the decision-59 SMS gate, the entitlement format check that catches
# App Store error 90778). Until this file existed, every one of them was runnable BY HAND
# ONLY: no pipeline ran them, so "the checks pass" meant "someone remembered to run them".
#
# run.sh needs nothing but `swift`, which Xcode Cloud has by definition. It runs every check
# even when an earlier one is red and exits 1 if any was, so this script's exit code is the
# whole suite's verdict and the log carries all of it.
#
# It reads NFCTimeSheets.entitlements and Localizable.xcstrings off disk and WRITES NOTHING
# (decision-49: the entitlement is the owner's file).
set -e

cd "$(dirname "$0")/.."     # NFCTimeSheets/

echo "ci_pre_xcodebuild: running checks/run.sh"
./checks/run.sh
