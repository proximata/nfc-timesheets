#!/bin/sh
# ci_post_xcodebuild.sh — Xcode Cloud custom build script.
#
# WHY THIS EXISTS
# Xcode Cloud's own "TestFlight (Internal Testing Only)" distribution post-action
# already uploads every archive to App Store Connect. What it does NOT do is add the
# new build to any TestFlight group — Apple's own docs are explicit about this:
#   "Builds created by Xcode Cloud must be manually added to groups in App Store
#   Connect." (developer.apple.com/help, "Add internal testers")
# That's why builds 21-29 sat with 0 groups and testers kept seeing an old build.
# This script closes that gap: after a successful archive, it asks fastlane's `pilot`
# to add the just-uploaded build to the "me" TestFlight group via the App Store
# Connect API, so the manual "Add Group" click in App Store Connect is no longer
# needed for day-to-day archives.
#
# This script NEVER fails the Xcode Cloud build over a distribution problem — the
# archive itself already succeeded by the time this runs; worst case you fall back
# to the old manual click in App Store Connect > TestFlight > iOS > (build) > Groups.
#
# ONE-TIME OWNER SETUP (App Store Connect UI, not something an agent can do):
#   1. Users and Access > Integrations > App Store Connect API > "+" > create a
#      TEAM key with role "App Manager" (or higher). Download the AuthKey_XXXX.p8
#      ONCE — Apple only lets you download it the one time.
#   2. Note the Key ID and Issuer ID shown next to it.
#   3. App Store Connect > NFC TimeSheets > Xcode Cloud > the "Default" workflow >
#      Environment > Environment Variables, add three:
#        APP_STORE_CONNECT_KEY_ID       = the Key ID from step 2
#        APP_STORE_CONNECT_ISSUER_ID    = the Issuer ID from step 2
#        APP_STORE_CONNECT_KEY_BASE64   = `base64 < AuthKey_XXXX.p8 | pbcopy`, then
#                                          paste — mark this one "Secret"
#   Until all three are set, this script logs a warning and does nothing (build
#   still succeeds normally, you just keep doing the manual group-add for now).
#
# ci_post_xcodebuild.sh runs after every `xcodebuild` invocation in the workflow,
# even a plain build/test — CI_XCODEBUILD_ACTION lets us only act on the archive.

set -eu

if [ "${CI_XCODEBUILD_ACTION:-}" != "archive" ]; then
  exit 0
fi

if [ -z "${APP_STORE_CONNECT_KEY_ID:-}" ] || [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ] || [ -z "${APP_STORE_CONNECT_KEY_BASE64:-}" ]; then
  echo "ci_post_xcodebuild: App Store Connect API key env vars not set, skipping auto TestFlight group add (see header comment for setup)"
  exit 0
fi

if ! command -v fastlane >/dev/null 2>&1; then
  echo "ci_post_xcodebuild: fastlane not found, installing..."
  if ! gem install fastlane --no-document -N; then
    echo "ci_post_xcodebuild: fastlane install failed, skipping auto TestFlight group add"
    exit 0
  fi
fi

WORKDIR="${CI_DERIVED_DATA_PATH:-/tmp}"
KEY_PEM="$WORKDIR/asc_api_key.p8.tmp"
KEY_JSON="$WORKDIR/asc_api_key.json"

echo "$APP_STORE_CONNECT_KEY_BASE64" | base64 --decode > "$KEY_PEM"

# fastlane's --api_key_path JSON file needs: key_id, issuer_id, key (the .p8 content
# with real newlines escaped as literal \n). See:
# https://docs.fastlane.tools/app-store-connect-api/#using-fastlane-api-key-json-file
KEY_ESCAPED=$(awk '{printf "%s\\n", $0}' "$KEY_PEM")
printf '{"key_id":"%s","issuer_id":"%s","key":"%s"}' \
  "$APP_STORE_CONNECT_KEY_ID" "$APP_STORE_CONNECT_ISSUER_ID" "$KEY_ESCAPED" > "$KEY_JSON"
rm -f "$KEY_PEM"

BUNDLE_ID="io.github.qwadratic.NFCTimeSheets"   # must match ops/branding.json (check-branding.mjs)

# Internal only for now. To also push straight to the real external tester on every
# CI build, change to GROUPS="me,ext" and add --distribute_external true below —
# deliberately not doing that by default since it would notify a real person on
# every archive, not just the ones you mean to hand them.
GROUPS="me"

if fastlane pilot distribute \
  --api_key_path "$KEY_JSON" \
  --app_identifier "$BUNDLE_ID" \
  --app_platform ios \
  --build_number "$CI_BUILD_NUMBER" \
  --groups "$GROUPS" \
  --skip_waiting_for_build_processing false \
  --notify_external_testers false; then
  echo "ci_post_xcodebuild: build $CI_BUILD_NUMBER added to TestFlight group(s): $GROUPS"
else
  echo "ci_post_xcodebuild: fastlane pilot distribute failed for build $CI_BUILD_NUMBER -- add it to the TestFlight group manually in App Store Connect"
fi

rm -f "$KEY_JSON"
exit 0
