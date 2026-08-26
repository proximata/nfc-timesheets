#!/bin/sh
# ci_post_xcodebuild.sh — Xcode Cloud custom build script.
#
# WHY THIS EXISTS
# Xcode Cloud's own "TestFlight (Internal Testing Only)" distribution post-action already
# uploads every archive to App Store Connect. What it does NOT do is add the new build to
# any TestFlight group — Apple's own docs are explicit about this: "Builds created by Xcode
# Cloud must be manually added to groups in App Store Connect." That's why builds 21-35 all
# sat with 0 groups while testers kept seeing an old one.
#
# WHY THIS IS RAW curl + openssl, NOT fastlane
# The first two versions of this script called `fastlane pilot distribute`. Both failed, on
# two different real Xcode Cloud runs, for two different reasons - read here rather than
# repeating the trip: (1) `gem install fastlane` needs root on this runner's system gem dir;
# (2) `--user-install` dodges that, but the runner's system Ruby is 2.6.10, and no fastlane
# release published in the last several years installs on anything older than Ruby 2.7 - a
# transitive dependency (`pp`) hard-requires it. Short of shipping a whole second Ruby via
# Homebrew + rbenv (a real, well-documented fix, and a real 4-6 extra minutes on every single
# archive, forever), fastlane cannot run here. The App Store Connect API itself is three
# plain REST calls; openssl and curl are the only tools this needs, and both ship with every
# macOS runner unconditionally, so there is nothing left to install. The JWT signing this
# replaces is ~20 lines of python3 (also always present) doing byte manipulation, not crypto
# math - openssl does the actual signing, python3 just reshapes its DER output into the raw
# r||s form JOSE wants and handles the JSON/base64url framing. All of this was verified
# against the LIVE API from a developer machine before ever going near CI again - see the
# 2026-08-26 session notes for the exact commands, including a real build (35) actually
# landing in the "me" group this way.
#
# ORDERING NOTE: this step runs BEFORE Xcode Cloud's own "Prepare Build for App Store
# Connect" step, i.e. before the archive has even been uploaded yet - the build this script
# is trying to distribute does not exist in the API when the script starts. That's what the
# polling loop below is for; it is not defensive padding.
#
# This script NEVER fails the Xcode Cloud build over a distribution problem - the archive
# itself already succeeded by the time this runs; worst case you fall back to the old manual
# click in App Store Connect > TestFlight > iOS > (build) > Groups.
#
# ONE-TIME OWNER SETUP (App Store Connect UI, not something an agent can do) - already done
# for this app as of 2026-08-26:
#   1. Users and Access > Integrations > App Store Connect API > "+" > create a TEAM key
#      with role "App Manager" (or higher). Download the AuthKey_XXXX.p8 ONCE - Apple only
#      lets you download it the one time.
#   2. Note the Key ID and Issuer ID shown next to it.
#   3. App Store Connect > NFC TimeSheets > Xcode Cloud > the "Default" workflow >
#      Environment > Environment Variables, add three:
#        APP_STORE_CONNECT_KEY_ID       = the Key ID from step 2
#        APP_STORE_CONNECT_ISSUER_ID    = the Issuer ID from step 2
#        APP_STORE_CONNECT_KEY_BASE64   = `base64 < AuthKey_XXXX.p8 | pbcopy`, then paste -
#                                          mark this one "Secret"
#   Until all three are set, this script logs a warning and does nothing (build still
#   succeeds normally, you just keep doing the manual group-add for now).
#
# STOP - READ THIS BEFORE RE-ENABLING ANY API CALL HERE.
# ci_post_xcodebuild.sh runs BEFORE Xcode Cloud's own "Prepare Build for App Store
# Connect" step - i.e. before the archive has been uploaded to Apple at all. A real build
# (37) proved this the hard way: this script tried to poll GET /v1/builds for the build
# THIS SAME ARCHIVE was producing, which cannot exist in the API until the later upload
# step runs - a deadlock by construction, not a network hiccup. It polled for exactly
# 15m0.2s until Xcode Cloud's own step timeout killed it, which failed the ENTIRE ARCHIVE
# and meant that commit's real code never reached TestFlight at all. The JWT-signing and
# betaGroups POST themselves are correct - proven against the live API from a developer
# machine using an already-processed historical build - the bug is purely which pipeline
# hook this ran from.
#
# There is no Xcode Cloud custom-script hook that runs AFTER the upload step; ci_post_clone,
# ci_pre_xcodebuild and ci_post_xcodebuild are all tied to the xcodebuild invocation, not the
# workflow's later distribution phase. A correct fix needs to live somewhere that runs
# independently of - and after - this pipeline: App Store Connect's own Webhooks feature
# (Users and Access > Integrations > Webhooks, a real "build finished processing" event
# exists) or a scheduled job elsewhere (this repo already runs two GitHub Actions
# pipelines - a `schedule:` cron reusing this exact curl+openssl JWT code, just triggered
# externally instead of from inside the build, would sidestep the deadlock entirely). Both
# are real follow-up work, not something to keep iterating on inside a script that fails
# a production archive every time it's wrong.
#
# Until one of those lands: this script does nothing. Add a build to the "me" TestFlight
# group by hand in App Store Connect > TestFlight > iOS > Builds - same manual step this
# whole file was trying to remove, restored on purpose after the cost of getting it wrong.
exit 0

# shellcheck disable=SC2317  # unreachable on purpose until the hook problem above is fixed
if [ "${CI_XCODEBUILD_ACTION:-}" != "archive" ]; then
  exit 0
fi

if [ -z "${APP_STORE_CONNECT_KEY_ID:-}" ] || [ -z "${APP_STORE_CONNECT_ISSUER_ID:-}" ] || [ -z "${APP_STORE_CONNECT_KEY_BASE64:-}" ]; then
  echo "ci_post_xcodebuild: App Store Connect API key env vars not set, skipping auto TestFlight group add (see header comment for setup)"
  exit 0
fi

# Stable for this app - both confirmed live against the API on 2026-08-26, both visible
# (not secret) in any App Store Connect URL for this app anyway. Hardcoded rather than
# resolved by bundle id / group name each run: one fewer network call, one fewer thing that
# can quietly resolve to the wrong app if this script is ever copied into another project
# without also changing these two lines.
APP_ID="6792530780"                                    # NFC TimeSheets
GROUP_ID="7f583737-4a08-42c6-bc40-d98465f87466"         # TestFlight Internal Testing "me"

WORKDIR="${CI_DERIVED_DATA_PATH:-/tmp}"
KEY_PEM="$WORKDIR/asc_api_key.p8.tmp"
echo "$APP_STORE_CONNECT_KEY_BASE64" | base64 --decode > "$KEY_PEM"

# A fresh ES256 JWT per API call rather than one held for the whole poll loop - the loop can
# run for minutes and a token this script mints itself is free to mint again.
mint_token() {
  python3 - "$APP_STORE_CONNECT_KEY_ID" "$APP_STORE_CONNECT_ISSUER_ID" "$KEY_PEM" <<'PY'
import base64, json, subprocess, sys, time

key_id, issuer_id, key_path = sys.argv[1], sys.argv[2], sys.argv[3]

def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=")

header = b64url(json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}, separators=(",", ":")).encode())
payload = b64url(json.dumps({"iss": issuer_id, "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"}, separators=(",", ":")).encode())
signing_input = header + b"." + payload

der = subprocess.run(
    ["openssl", "dgst", "-sha256", "-sign", key_path],
    input=signing_input, capture_output=True, check=True,
).stdout

# DER ECDSA-Sig-Value (SEQUENCE of two INTEGERs) -> raw r||s, 32 bytes each (P-256) - the
# fixed-width form JOSE requires and DER never gives you directly.
def read_int(buf, i):
    assert buf[i] == 0x02
    length = buf[i + 1]
    start = i + 2
    val = buf[start:start + length].lstrip(b"\x00").rjust(32, b"\x00")[-32:]
    return val, start + length

i = 2  # skip SEQUENCE tag + length byte
r, i = read_int(der, i)
s, i = read_int(der, i)

sys.stdout.write((signing_input + b"." + b64url(r + s)).decode())
PY
}

api_get() {
  # $1 = path+query (already using [] filter syntax) - --globoff because curl treats bare
  # [ ] as its own URL-globbing syntax and silently mangles the App Store Connect filter
  # params otherwise.
  curl --globoff -sf --max-time 20 -H "Authorization: Bearer $(mint_token)" \
    "https://api.appstoreconnect.apple.com/v1/$1"
}

# The archive that triggered this script has not been uploaded yet - "Prepare Build for App
# Store Connect" runs AFTER this step. Poll for it to appear and finish processing rather
# than assuming it is there.
BUILD_ID=""
PROCESSING_STATE=""
attempt=0
max_attempts=80   # 80 * 15s = 20 minutes
while [ "$attempt" -lt "$max_attempts" ]; do
  attempt=$((attempt + 1))
  RESP=$(api_get "builds?filter[app]=$APP_ID&filter[version]=$CI_BUILD_NUMBER&limit=1" || true)
  BUILD_ID=$(printf '%s' "$RESP" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)["data"]
    print(d[0]["id"] + " " + d[0]["attributes"]["processingState"] if d else "")
except Exception:
    print("")' 2>/dev/null || true)
  if [ -n "$BUILD_ID" ]; then
    PROCESSING_STATE="${BUILD_ID#* }"
    BUILD_ID="${BUILD_ID%% *}"
    case "$PROCESSING_STATE" in
      VALID) break ;;
      FAILED|INVALID)
        echo "ci_post_xcodebuild: build $CI_BUILD_NUMBER is $PROCESSING_STATE in App Store Connect, not adding to a TestFlight group"
        rm -f "$KEY_PEM"
        exit 0
        ;;
      *) : ;; # PROCESSING or anything else Apple adds later - keep waiting
    esac
  fi
  sleep 15
done

rm -f "$KEY_PEM"

if [ "$PROCESSING_STATE" != "VALID" ]; then
  echo "ci_post_xcodebuild: build $CI_BUILD_NUMBER did not finish processing within 20 minutes, skipping auto TestFlight group add -- add it manually in App Store Connect"
  exit 0
fi

HTTP_STATUS=$(curl --globoff -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST \
  -H "Authorization: Bearer $(mint_token)" -H "Content-Type: application/json" \
  -d "{\"data\":[{\"type\":\"builds\",\"id\":\"$BUILD_ID\"}]}" \
  "https://api.appstoreconnect.apple.com/v1/betaGroups/$GROUP_ID/relationships/builds" || echo "000")

if [ "$HTTP_STATUS" = "204" ]; then
  echo "ci_post_xcodebuild: build $CI_BUILD_NUMBER added to the TestFlight internal group"
else
  echo "ci_post_xcodebuild: adding build $CI_BUILD_NUMBER to the TestFlight group failed (HTTP $HTTP_STATUS) -- add it manually in App Store Connect"
fi

exit 0
