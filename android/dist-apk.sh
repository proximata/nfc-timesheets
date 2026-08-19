#!/usr/bin/env bash
# Publish the built release APK into android/dist/ under a name taken FROM THE BYTES.
#
#     cd android && ./dist-apk.sh
#
# WHY THIS EXISTS. `dist/` is gitignored (android/.gitignore:20), nothing documented how a
# file got into it, and the last build was copied there by hand. The next one was not: a
# run reported `android/dist/nfc-timesheets-0.3.0-4-release.apk` as its deliverable and the
# only 0.3.0 bytes on this machine were in `app/build/outputs/apk/release/app-release.apk`.
# That path is the FIRST STEP of the highest-ranked action in the project - getting a
# working build onto the one phone in the field - and it would have failed with "No such
# file", after the phone had already been fetched.
#
# So the name is never typed. It is read out of the APK's own manifest with aapt2, which
# makes a name that disagrees with the bytes unrepresentable rather than merely unlikely.
#
# IT REFUSES A DEBUG SIGNATURE, and that refusal is the point of the file as much as the
# copy is. The phone in the field carries a build signed with the upload key and a LIVE
# WORKER SESSION. `adb install -r` of a differently-signed APK fails with
# INSTALL_FAILED_UPDATE_INCOMPATIBLE; the obvious next move is `adb uninstall`, and that
# wipes the session - which is the one thing that must not happen while re-enrolment needs
# an admin to issue a code. Better to refuse here, with the reason, than on a doorstep.
set -euo pipefail

cd "$(dirname "$0")"     # android/

BUILT="app/build/outputs/apk/release/app-release.apk"
DIST="dist"

STUDIO="/Applications/Android Studio.app/Contents"
[ -n "${JAVA_HOME:-}" ] || { [ -d "$STUDIO/jbr/Contents/Home" ] && export JAVA_HOME="$STUDIO/jbr/Contents/Home"; }
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}}"

# Newest build-tools wins: these two binaries are backwards compatible and pinning a
# version here would break the day the operator updates the SDK.
AAPT2="$(ls -d "$SDK"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"

if [ ! -f "$BUILT" ]; then
  echo "dist-apk: no release build at $BUILT" >&2
  echo "          build one first:  ./gradlew assembleRelease" >&2
  exit 1
fi
if [ -z "$AAPT2" ] || [ -z "$APKSIGNER" ]; then
  echo "dist-apk: aapt2/apksigner not found under $SDK/build-tools" >&2
  echo "          set ANDROID_HOME to the SDK that has them" >&2
  exit 127
fi

# NOT `| head -1`. With `set -o pipefail` that returns 141: head closes the pipe, aapt2
# takes SIGPIPE, and the script exits non-zero AFTER doing its job correctly - which is the
# worst kind of failure, because the file is there and the caller has been told it is not.
badging_all="$("$AAPT2" dump badging "$BUILT")"
badging="${badging_all%%$'\n'*}"
# ANCHORED, unlike the two below. `.*name='` is greedy and the badging line ends with
# `compileSdkVersionCodename='16'` - which contains a lowercase `name='` - so the
# unanchored form reported the package as "16" and printed an adb command nobody could run.
pkg="$(printf '%s' "$badging"    | sed -n "s/^package: name='\([^']*\)'.*/\1/p")"
code="$(printf '%s' "$badging"   | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p")"
name="$(printf '%s' "$badging"   | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")"
[ -n "$code" ] && [ -n "$name" ] || { echo "dist-apk: could not read versionCode/versionName from $BUILT" >&2; exit 1; }

certs="$("$APKSIGNER" verify --print-certs "$BUILT" 2>&1)"
dn="$(printf '%s' "$certs"     | sed -n 's/^Signer #1 certificate DN: //p')"
sha="$(printf '%s' "$certs"    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p')"

case "$dn" in
  *"Android Debug"*)
    echo "dist-apk: REFUSING - this APK is signed with the DEBUG key ($dn)." >&2
    echo "          Installing it over the field build fails with" >&2
    echo "          INSTALL_FAILED_UPDATE_INCOMPATIBLE, and uninstalling to get past that" >&2
    echo "          wipes the worker session on the only phone in service." >&2
    echo "          Put the upload keystore in android/keystore.properties (README §Signing)" >&2
    echo "          and rebuild." >&2
    exit 1
    ;;
esac

# The fingerprint ops/branding.json publishes in assetlinks.json. A release signed with
# anything else is an app whose App Links will not verify, i.e. taps open Chrome.
want="$(tr 'a-f' 'A-F' <<<"$sha" | sed 's/../&:/g; s/:$//')"
if ! grep -q "$want" ../ops/branding.json; then
  echo "dist-apk: REFUSING - the signer is not the one assetlinks.json publishes." >&2
  echo "          apk:      $want" >&2
  echo "          branding: $(sed -n 's/.*"\([0-9A-F][0-9A-F]:[0-9A-F:]*\)".*/\1/p' ../ops/branding.json)" >&2
  echo "          A tap would open Chrome instead of the app on every tag." >&2
  exit 1
fi

mkdir -p "$DIST"
out="$DIST/nfc-timesheets-$name-$code-release.apk"
# -p: the modification time is the RENDER time, and a dist directory whose dates lie is a
# dist directory nobody can reason about.
cp -p "$BUILT" "$out"

cat <<EOF
dist-apk: $out
  package      $pkg
  versionCode  $code
  versionName  $name
  signer       $dn
  SHA-256      $sha
               (matches ops/branding.json, so App Links can verify)

Install over the field build - NEVER uninstall first, that wipes the session:
  adb install -r $out
  adb shell dumpsys package $pkg | grep versionCode   # must read $code
EOF
