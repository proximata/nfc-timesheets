#!/bin/sh
# Point the iOS app at the LOCAL demo server on a simulator, without changing one tracked
# file.
#
#   sh demo/ios-setup.sh                    # cert, boot, trust, build, install
#   sh demo/ios-setup.sh --allow-notifications   # the one step that needs Simulator.app
#   sh demo/ios-setup.sh --prove-release    # the Release binary contains no demo hook
#
# WHAT MAKES THE APP TALK TO THE DEMO SERVER, and why it needs no edit:
#
#   API.swift builds its base URL as `https://\(TagLink.host)`, TagLink.host is
#   Branding.tagHost, and Branding.tagHost reads the `TSTagHost` Info.plist key, which Xcode
#   substitutes from the `TS_TAG_HOST` BUILD SETTING. A build setting can be given on the
#   xcodebuild command line, so `TS_TAG_HOST=127.0.0.1:8443` produces a build that talks to
#   the demo server with Branding.xcconfig, Info.plist, the entitlements and
#   project.pbxproj all untouched. `git status` is clean after this script.
#
# THREE THINGS A SIMULATOR CANNOT DO, and what is done about each:
#
#   1. PORT 443. macOS refuses a non-root bind below 1024 — measured, not assumed:
#        node -e 'require("net").createServer().listen(443,"127.0.0.1")'
#        -> Error: listen EACCES: permission denied 127.0.0.1:443
#      The Android demo dodges this with `adb reverse`, which binds the port inside the
#      emulator where adbd is root. A simulator shares the Mac's network stack and has no
#      equivalent, so the demo host carries the port: `127.0.0.1:8443`.
#      CONSEQUENCE, stated because it is load-bearing: TagLink.locationId compares
#      `URLComponents.host` (no port) against Branding.tagHost (with port), so a build
#      configured this way cannot parse a universal link at all. That costs nothing here,
#      because of (2).
#
#   2. UNIVERSAL LINKS. `xcodebuild -showBuildSettings -sdk iphonesimulator` reports
#      `ENTITLEMENTS_ALLOWED = NO` (against `YES` for `-sdk iphoneos`), and forcing
#      `ENTITLEMENTS_ALLOWED=YES` on the command line still yields `<dict/>` from
#      `codesign -d --entitlements`. No entitlements means no
#      `com.apple.developer.associated-domains`, which means iOS never claims the link for
#      this app: `simctl openurl https://<host>/t?l=<uuid>` opens Safari, every time. This
#      is a property of the simulator SDK, not of this app — the same tap works on a device
#      and is what workers use daily. The demo therefore injects the id AFTER the parse,
#      through the DEBUG-only hook in NFCTimeSheets/DemoHooks.swift, into the same TapInbox.
#
#   3. SIGN IN WITH APPLE. No Apple ID, and signing one in needs a human, a password and a
#      2FA code. demo/demo-server.mjs mints a real RS256 identity token and tells ITSELF —
#      through the `setKeyFetcherForTest` seam server/check-api.js already uses — that the
#      key is Apple's. Every check in server/lib/apple.js still runs.
#
# NFC ITSELF IS NOT SIMULATED AND CANNOT BE. There is no NFC radio in a simulator. The app
# says so on screen for as long as the hooks are armed (DemoHooks.demoBanner).
set -e
cd "$(dirname "$0")/.."

BUNDLE=io.github.qwadratic.NFCTimeSheets
SIM="${DEMO_SIM:-iPhone 17}"
TLS_DIR="${TLS_DIR:-/tmp/ts-demo/tls}"
DD="${DEMO_DERIVED:-/tmp/ts-demo/dd}"
TAG_HOST="${DEMO_TAG_HOST:-127.0.0.1:8443}"

# Same refusal as record-admin.mjs, record-android.mjs and tls-front.mjs. A build that can
# be handed a forged sign-in must never be able to reach the live server.
case "${TAG_HOST%%:*}" in
  127.0.0.1|localhost|::1) ;;
  *) echo "ios-setup: refusing DEMO_TAG_HOST \"$TAG_HOST\" — loopback only."; exit 1 ;;
esac

# ---------------------------------------------------------------------------------------
# --prove-release: the demo hooks are #if DEBUG, so a Release build must not contain one
# byte of them. Greps every file in the built .app, not just the main binary — a Debug
# build puts the code in NFCTimeSheets.debug.dylib and grepping only the executable would
# have "proved" the Debug build clean too.
# ---------------------------------------------------------------------------------------
if [ "$1" = "--prove-release" ]; then
  out=/tmp/ts-demo/dd-release
  echo "== building Release for the simulator =="
  xcodebuild -project NFCTimeSheets/NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
    -configuration Release -sdk iphonesimulator \
    -destination "platform=iOS Simulator,name=$SIM" \
    -derivedDataPath "$out" CODE_SIGNING_ALLOWED=NO build >/dev/null
  app="$out/Build/Products/Release-iphonesimulator/NFCTimeSheets.app"
  hits=0
  for f in $(find "$app" -type f); do
    n=$(strings -a "$f" 2>/dev/null | grep -icE 'TSDemoHooksArmed|ts-demo-signin|ts-demo-tap|NFC is MOCKED' || true)
    hits=$((hits + n))
    [ "$n" -gt 0 ] && echo "  FAIL $n demo marker(s) in $f"
  done
  if [ "$hits" -eq 0 ]; then
    echo "prove-release: OK — no demo hook in $app"
  else
    echo "prove-release: $hits FAIL"; exit 1
  fi
  exit 0
fi

# ---------------------------------------------------------------------------------------
# --allow-notifications: the ONE step that needs the Simulator window.
#
# The app-icon badge is the out-of-app signal iOS actually delivers today (the Live
# Activity is inert — there is no widget extension target), and a badge needs notification
# authorization. `xcrun simctl privacy` has no `notifications` service, so the system alert
# has to be answered. It is answered through Accessibility, by BUTTON DESCRIPTION rather
# than by screen coordinates, so it does not break when the alert moves.
#
# ponytail: run once per simulator. The grant lives in SpringBoard, not in the app
# container, so demo/record-ios.mjs wiping the container leaves it intact and every
# recording after this one is headless. CEILING: `simctl erase`, or uninstalling the app,
# loses it. UPGRADE PATH: re-run this.
# ---------------------------------------------------------------------------------------
if [ "$1" = "--allow-notifications" ]; then
  loc="${2:-}"
  [ -n "$loc" ] || { echo "usage: sh demo/ios-setup.sh --allow-notifications <location-uuid>"; exit 1; }
  [ -f /tmp/ts-demo/identity.json ] || { echo "no /tmp/ts-demo/identity.json — start demo/demo-server.mjs first"; exit 1; }
  token=$(/usr/bin/python3 -c 'import json;print(json.load(open("/tmp/ts-demo/identity.json"))["identity_token"])')
  nonce=$(/usr/bin/python3 -c 'import json;print(json.load(open("/tmp/ts-demo/identity.json"))["nonce"])')

  open -a Simulator
  sleep 6
  xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch booted "$BUNDLE" --ts-demo --ts-demo-signin "$token" --ts-demo-nonce "$nonce" >/dev/null
  sleep 8
  xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch booted "$BUNDLE" --ts-demo --ts-demo-tap "$loc" >/dev/null
  sleep 8

  osascript -e 'tell application "System Events" to tell process "Simulator" to click (first button of entire contents of window 1 whose description is "Allow")' >/dev/null 2>&1 \
    || echo "  (no Allow button found — already granted, or Simulator.app is not showing the device)"
  sleep 3

  # Leave the demo database exactly as it was found: the same tap closes the shift again.
  xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
  xcrun simctl launch booted "$BUNDLE" --ts-demo --ts-demo-tap "$loc" >/dev/null
  sleep 8
  xcrun simctl terminate booted "$BUNDLE" 2>/dev/null || true
  echo "allow-notifications: done. Verify with a badge on the icon during the next run."
  exit 0
fi

# ---------------------------------------------------------------------------------------
# 1. A certificate. Same throwaway CA the Android demo uses; the SAN already covers
#    127.0.0.1, so a simulator and an emulator can share one.
# ---------------------------------------------------------------------------------------
if [ ! -f "$TLS_DIR/ca.pem" ]; then
  echo "== generating a 30-day demo CA in $TLS_DIR =="
  mkdir -p "$TLS_DIR"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 30 -nodes \
    -keyout "$TLS_DIR/ca.key" -out "$TLS_DIR/ca.pem" \
    -subj "/CN=NFC TimeSheets DEMO CA/O=local demo only" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "$TLS_DIR/server.key" -out "$TLS_DIR/server.csr" \
    -subj "/CN=timesheets.exe.xyz" 2>/dev/null
  printf 'subjectAltName=DNS:timesheets.exe.xyz,DNS:localhost,IP:127.0.0.1,IP:10.0.2.2\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' \
    > "$TLS_DIR/ext.cnf"
  openssl x509 -req -in "$TLS_DIR/server.csr" -CA "$TLS_DIR/ca.pem" -CAkey "$TLS_DIR/ca.key" \
    -CAcreateserial -out "$TLS_DIR/server.pem" -days 30 -sha256 -extfile "$TLS_DIR/ext.cnf" 2>/dev/null
fi

# ---------------------------------------------------------------------------------------
# 2. Boot, and trust the CA. `simctl keychain add-root-cert` puts it in the simulator's
#    trust store, so URLSession accepts the demo certificate with no ATS exception and no
#    change to the app.
# ---------------------------------------------------------------------------------------
echo "== booting \"$SIM\" =="
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
echo "== trusting the demo CA inside the simulator =="
xcrun simctl keychain booted add-root-cert "$TLS_DIR/ca.pem"

# ---------------------------------------------------------------------------------------
# 3. Build with TS_TAG_HOST overridden, and PROVE the override landed. A silent failure
#    here is a build that quietly points at the live host, which is the one outcome this
#    whole rig exists to prevent.
# ---------------------------------------------------------------------------------------
echo "== building Debug for the simulator with TS_TAG_HOST=$TAG_HOST =="
xcodebuild -project NFCTimeSheets/NFCTimeSheets.xcodeproj -scheme NFCTimeSheets \
  -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,name=$SIM" \
  -derivedDataPath "$DD" TS_TAG_HOST="$TAG_HOST" CODE_SIGNING_ALLOWED=NO build >/dev/null

APP="$DD/Build/Products/Debug-iphonesimulator/NFCTimeSheets.app"
GOT=$(/usr/libexec/PlistBuddy -c 'Print :TSTagHost' "$APP/Info.plist")
if [ "$GOT" != "$TAG_HOST" ]; then
  echo "ios-setup: built Info.plist says TSTagHost=\"$GOT\", expected \"$TAG_HOST\" — refusing to install."
  exit 1
fi
echo "  TSTagHost = $GOT"

echo "== installing =="
xcrun simctl install booted "$APP"

echo
echo "ready. next:"
# The key is printed IN FULL and not as an ellipsis. It is the value compiled into
# API.swift and android/branding.properties, it is committed in cleartext there, and it is
# not a secret. An ellipsis here cost a debugging cycle: every app request came back 401
# with no diagnostic beyond "Apple sign-in failed. Try again."
echo "  DATABASE_URL=postgres:///nfc_demo \\"
echo "  APP_KEY=$(sed -n 's/.*\"\(tsk_[a-f0-9]*\)\".*/\1/p' NFCTimeSheets/NFCTimeSheets/API.swift | head -1) \\"
echo "  PORT=8082 PUBLIC_DIR=web/out node demo/demo-server.mjs"
echo "  node demo/tls-front.mjs                      # https :8443 -> http :8082"
echo "  sh demo/ios-setup.sh --allow-notifications <location-uuid>   # once per simulator"
echo "  node demo/record-ios.mjs"
