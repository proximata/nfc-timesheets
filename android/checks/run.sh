#!/usr/bin/env bash
# Runs android/checks/core-check.kt on a plain JVM. No Gradle, no Android SDK, no
# emulator, no device — that is the point: everything it covers is logic that would
# otherwise only be discovered at a door, in the dark, with a tag in one hand.
#
#     cd android && ./checks/run.sh
#
# Needs: kotlinc (2.0+) and a JDK 17+. Neither is a project dependency — they are the
# Android toolchain the operator already has, and this reuses it.
#   brew install kotlin openjdk@17     (or set KOTLINC=/path/to/kotlinc)
#
# One third-party jar is fetched on first run into checks/.lib (gitignored, never
# vendored): org.json, which on a real device comes from android.jar. Nothing else is
# downloaded, because the app has no other non-platform dependency.
set -euo pipefail

cd "$(dirname "$0")/.."     # android/

KOTLINC="${KOTLINC:-kotlinc}"
if ! command -v "$KOTLINC" >/dev/null 2>&1; then
  echo "checks: kotlinc not found. brew install kotlin, or set KOTLINC=/path/to/kotlinc" >&2
  exit 127
fi

JSON_VERSION=20250107
LIB=checks/.lib
OUT=checks/.out
JSON_JAR="$LIB/json-$JSON_VERSION.jar"

mkdir -p "$LIB" "$OUT"
if [ ! -f "$JSON_JAR" ]; then
  echo "checks: fetching org.json:json:$JSON_VERSION (android.jar's copy is not available off-device)"
  curl -fsSL -o "$JSON_JAR" \
    "https://repo1.maven.org/maven2/org/json/json/$JSON_VERSION/json-$JSON_VERSION.jar"
fi

# Only the pure core compiles here. Anything under data/, net/, ui/ imports Android and
# is NOT covered — see android/README.md § "What is unproven".
CORE=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core

"$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT" \
  "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/TapInbox.kt "$CORE"/Wire.kt "$CORE"/SyncPlan.kt \
  "$CORE"/EnrolmentCode.kt "$CORE"/SessionCookie.kt \
  checks/core-check.kt

KOTLIN_HOME="$(dirname "$(dirname "$(command -v "$KOTLINC")")")"
STDLIB="$KOTLIN_HOME/lib/kotlin-stdlib.jar"
[ -f "$STDLIB" ] || STDLIB="$(find "$KOTLIN_HOME" -name 'kotlin-stdlib*.jar' | head -1)"

java -cp "$OUT:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.CoreCheck
