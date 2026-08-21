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
# Fallback: Android Studio ships both a kotlinc and a JDK. On a machine set up for this
# project that is the toolchain that is already there, so use it rather than asking for a
# second one. Explicit KOTLINC still wins.
STUDIO="/Applications/Android Studio.app/Contents"
if ! command -v "$KOTLINC" >/dev/null 2>&1 && [ -x "$STUDIO/plugins/Kotlin/kotlinc/bin/kotlinc" ]; then
  KOTLINC="$STUDIO/plugins/Kotlin/kotlinc/bin/kotlinc"
  [ -n "${JAVA_HOME:-}" ] || export JAVA_HOME="$STUDIO/jbr/Contents/Home"
fi
if ! command -v "$KOTLINC" >/dev/null 2>&1; then
  echo "checks: kotlinc not found. brew install kotlin, or set KOTLINC=/path/to/kotlinc" >&2
  exit 127
fi
# kotlinc and the `java` on PATH may be different JVMs; JAVA_HOME decides for both.
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}java"

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
  "$CORE"/PendingWork.kt "$CORE"/EnrolmentCode.kt "$CORE"/SessionCookie.kt "$CORE"/MaterialQueue.kt "$CORE"/ShiftSignal.kt \
  "$CORE"/Zones.kt "$CORE"/UpdateCheck.kt "$CORE"/NdefTag.kt "$CORE"/WriteGuard.kt \
  checks/core-check.kt

KOTLIN_HOME="$(dirname "$(dirname "$(command -v "$KOTLINC")")")"
STDLIB="$KOTLIN_HOME/lib/kotlin-stdlib.jar"
[ -f "$STDLIB" ] || STDLIB="$(find "$KOTLIN_HOME" -name 'kotlin-stdlib*.jar' | head -1)"

"$JAVA_BIN" -cp "$OUT:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.CoreCheck

# Adopted third-party tags (nfc/KnownTags). Compiled separately because it lives outside
# core/ — it is still Android-free, which is the only reason this can run off-device.
NFC=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc
# Wire.kt declares WireZone (needed by core/Zones.kt) but its materialRequest() decoder
# also references WireMaterialRequest, which lives in MaterialQueue.kt, which in turn
# references ApiFailure — so this compile unit pulls in the same transitive set as the
# main CoreCheck build above, even though this check calls none of that surface.
"$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT" \
  "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
  "$CORE"/UpdateCheck.kt \
  "$NFC"/KnownTags.kt checks/known-tags-check.kt

"$JAVA_BIN" -cp "$OUT:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.KnownTagsCheck

# THE WRITE LOOP. nfc/TagWriter.kt is the one class here that modifies a physical object,
# and until this ran it was the one class nothing had loaded: it imports android.nfc, so no
# JVM check could compile it, and NFC hardware does not exist on an emulator, so no emulator
# run could reach it either. checks/fake/ stubs exactly the android.nfc surface it touches —
# recording every call in order, and THROWING on makeReadOnly() and cachedNdefMessage — so
# "capacity is checked before any write" becomes an assertion about an observed call log.
#
# The stub is compiled into a SEPARATE output dir. android.nfc.* classes must never end up
# on a classpath the other checks share, and must obviously never reach the app build.
OUT_NFC=checks/.out-nfc
mkdir -p "$OUT_NFC"
"$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT_NFC" \
  "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
  "$CORE"/UpdateCheck.kt "$CORE"/NdefTag.kt "$CORE"/WriteGuard.kt \
  checks/fake/FakeCard.kt checks/fake/android-nfc.kt checks/fake/android-nfc-tech.kt \
  "$NFC"/TagWriter.kt checks/tag-writer-check.kt

"$JAVA_BIN" -cp "$OUT_NFC:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.Tag_writer_checkKt
