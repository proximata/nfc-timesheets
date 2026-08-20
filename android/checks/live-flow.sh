#!/usr/bin/env bash
# Compile and run checks/live-flow-check.kt — the phone half of ops/prove-live.sh.
#
#     cd android && LIVE_HOIV_ID=<uuid off the live box> ./checks/live-flow.sh <outdir>
#
# Separate from checks/run.sh on purpose: run.sh must stay runnable on a laptop with no
# network and no production, and this one REFUSES to run without a uuid read out of the
# live database (see the check's own header). ops/prove-live.sh is its only caller.
#
# Same toolchain discovery as checks/run.sh, and the same two output dirs — the android.nfc
# stubs are compiled into their own, never onto a classpath the other checks share.
set -euo pipefail

cd "$(dirname "$0")/.."     # android/

OUT_DIR="${1:-checks/.live-out}"

KOTLINC="${KOTLINC:-kotlinc}"
STUDIO="/Applications/Android Studio.app/Contents"
if ! command -v "$KOTLINC" >/dev/null 2>&1 && [ -x "$STUDIO/plugins/Kotlin/kotlinc/bin/kotlinc" ]; then
  KOTLINC="$STUDIO/plugins/Kotlin/kotlinc/bin/kotlinc"
  [ -n "${JAVA_HOME:-}" ] || export JAVA_HOME="$STUDIO/jbr/Contents/Home"
fi
if ! command -v "$KOTLINC" >/dev/null 2>&1; then
  echo "live-flow: kotlinc not found. brew install kotlin, or set KOTLINC=/path/to/kotlinc" >&2
  exit 127
fi
JAVA_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}java"

JSON_VERSION=20250107
LIB=checks/.lib
JSON_JAR="$LIB/json-$JSON_VERSION.jar"
mkdir -p "$LIB"
if [ ! -f "$JSON_JAR" ]; then
  curl -fsSL -o "$JSON_JAR" \
    "https://repo1.maven.org/maven2/org/json/json/$JSON_VERSION/json-$JSON_VERSION.jar"
fi

CORE=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core
NFC=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc
# THE DEBUG SOURCE SET, compiled in. There is a file with the same name and package under
# src/release/ whose writeSimulations() returns an empty list; compiling that one instead
# would make § 2 iterate nothing and pass vacuously, so the path is explicit and asserted
# below rather than globbed.
DEBUG_SIM=app/src/debug/kotlin/io/github/qwadratic/nfctimesheets/nfc/WriteSimulation.kt
[ -f "$DEBUG_SIM" ] || { echo "live-flow: $DEBUG_SIM is missing" >&2; exit 1; }
/usr/bin/grep -q 'MOUNTED' "$DEBUG_SIM" \
  || { echo "live-flow: $DEBUG_SIM is not the debug simulator (no MOUNTED scenario)" >&2; exit 1; }

OUT_NFC=checks/.out-live
rm -rf "$OUT_NFC"; mkdir -p "$OUT_NFC" "$OUT_DIR"

"$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT_NFC" \
  "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
  "$CORE"/UpdateCheck.kt "$CORE"/NdefTag.kt "$CORE"/WriteGuard.kt \
  checks/fake/FakeCard.kt checks/fake/android-nfc.kt checks/fake/android-nfc-tech.kt \
  "$NFC"/TagWriter.kt "$DEBUG_SIM" checks/live-flow-check.kt

KOTLIN_HOME="$(dirname "$(dirname "$(command -v "$KOTLINC")")")"
STDLIB="$KOTLIN_HOME/lib/kotlin-stdlib.jar"
[ -f "$STDLIB" ] || STDLIB="$(find "$KOTLIN_HOME" -name 'kotlin-stdlib*.jar' | head -1)"

"$JAVA_BIN" -cp "$OUT_NFC:$JSON_JAR:$STDLIB" \
  io.github.qwadratic.nfctimesheets.checks.Live_flow_checkKt "$OUT_DIR"
