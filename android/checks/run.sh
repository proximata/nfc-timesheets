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
#
# EVERY CHECK RUNS, ALWAYS (TASK-322). Setup below is fail-fast (no toolchain, no run at
# all), but from the CHECKS section onwards a red check no longer kills the script: each
# one is recorded pass/fail and the rest still run, because the first failure hiding seven
# unknowns is worse than seven known failures. Summary table at the end, exit 1 if any red.
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

check_core() {
  "$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT" \
    "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/AppVersionGate.kt "$CORE"/TapInbox.kt "$CORE"/Wire.kt "$CORE"/SyncPlan.kt \
    "$CORE"/PendingWork.kt "$CORE"/EnrolmentCode.kt "$CORE"/SessionCookie.kt "$CORE"/MaterialQueue.kt "$CORE"/ShiftSignal.kt \
    "$CORE"/Zones.kt "$CORE"/NdefTag.kt "$CORE"/WriteGuard.kt "$CORE"/TagTlv.kt "$CORE"/Scrub.kt \
    checks/core-check.kt &&
  "$JAVA_BIN" -cp "$OUT:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.CoreCheck
}

KOTLIN_HOME="$(dirname "$(dirname "$(command -v "$KOTLINC")")")"
STDLIB="$KOTLIN_HOME/lib/kotlin-stdlib.jar"
[ -f "$STDLIB" ] || STDLIB="$(find "$KOTLIN_HOME" -name 'kotlin-stdlib*.jar' | head -1)"

# Adopted third-party tags (nfc/KnownTags). Compiled separately because it lives outside
# core/ — it is still Android-free, which is the only reason this can run off-device.
NFC=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc
# Wire.kt declares WireZone (needed by core/Zones.kt) but its materialRequest() decoder
# also references WireMaterialRequest, which lives in MaterialQueue.kt, which in turn
# references ApiFailure — so this compile unit pulls in the same transitive set as the
# main CoreCheck build above, even though this check calls none of that surface.
check_known_tags() {
  "$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT" \
    "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
    "$NFC"/KnownTags.kt checks/known-tags-check.kt &&
  "$JAVA_BIN" -cp "$OUT:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.KnownTagsCheck
}

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
check_tag_writer() {
  "$KOTLINC" -nowarn -cp "$JSON_JAR" -d "$OUT_NFC" \
    "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
    "$CORE"/NdefTag.kt "$CORE"/WriteGuard.kt \
    checks/fake/FakeCard.kt checks/fake/android-nfc.kt checks/fake/android-nfc-tech.kt \
    "$NFC"/TagWriter.kt checks/tag-writer-check.kt &&
  "$JAVA_BIN" -cp "$OUT_NFC:$JSON_JAR:$STDLIB" io.github.qwadratic.nfctimesheets.checks.Tag_writer_checkKt
}

# THE FALLBACK READ. nfc/RawTagIo.kt is the other half of the same problem: it imports
# android.nfc.tech and needs a physical Type 2 Tag, so nothing had ever executed it either —
# and it is the code that runs ONLY once the platform reader has already failed, i.e. only on
# the card that is already going wrong. checks/fake/RawCard.kt models a Type 2 memory (page
# reads, and both behaviours at the end of it) so the collection loop can be driven off-device.
# Its own output dir, for android-nfc-tech.kt's reason: android.nfc.* stays off every other
# check's classpath.
OUT_RAW=checks/.out-raw
mkdir -p "$OUT_RAW"
check_raw_tag_io() {
  "$KOTLINC" -nowarn -d "$OUT_RAW" \
    "$CORE"/TagLink.kt "$CORE"/NdefTag.kt "$CORE"/TagTlv.kt \
    checks/fake/android-nfc.kt checks/fake/RawCard.kt checks/fake/android-nfc-tech-raw.kt \
    "$NFC"/RawTagIo.kt checks/raw-tag-io-check.kt &&
  "$JAVA_BIN" -cp "$OUT_RAW:$STDLIB" io.github.qwadratic.nfctimesheets.checks.Raw_tag_io_checkKt
}

# THE MANIFEST. Everything above this line reads Android-free Kotlin, which is what makes
# it runnable on a laptop — and is also why none of it could see that the background push
# was dead on every device for want of one <uses-permission> line (TASK-225). This last
# check reads the manifest against the scheduler's own source. See checks/manifest-check.sh.
# Direct execution, not `sh checks/…`: these three scripts declare `#!/usr/bin/env bash`
# and use `set -o pipefail`, a bashism. Wrapping them in `sh` overrides that shebang and
# hands them to whatever `sh` actually is - on this Mac, close enough to bash to tolerate
# `pipefail` by accident; on the Ubuntu CI runner this workflow was just wired into,
# `/bin/sh` is dash, which does not know that option at all ("Illegal option -o pipefail"),
# so play-release.yml's very first real run of this gate failed on shell portability before
# it ever reached the checks' own assertions. Running them directly lets the kernel honour
# the shebang everywhere, which is what should have been happening all along.
check_manifest() { checks/manifest-check.sh; }

# THE TEST SCAN CANNOT OPEN A SHIFT (decision-47). nfc/VerifyZoneActivity.kt imports
# android.nfc, so it cannot be compiled into the JVM checks above; this proves the one
# property that matters about it — no path to the clock-in intent, the tap inbox or the
# worker-session client — by reading its source the same way manifest-check.sh reads the
# manifest. See checks/verify-no-shift-check.sh.
check_verify_no_shift() { checks/verify-no-shift-check.sh; }

# THE READER IS DISARMED MID-RECOVERY (TASK-301). Same reason this is a source check and not
# a JVM one: readerWanted() imports android.nfc and the state it guards needs a real card.
check_reader_armed() { checks/reader-armed-check.sh; }

# THE OPERATOR SESSION DIES AND THE PHONE FINDS OUT (TASK-401). The only check here that
# makes a real network request: it starts an HTTPS server on loopback, points BuildConfig at
# it and drives the SHIPPING net/Api.kt into a real 401 on a real operator route. That is
# what makes "the stale cookie is cleared and the gate closes" an observation rather than a
# reading of the source. Needs kotlinx-coroutines (Api is suspending), which kotlinc ships.
OUT_NET=checks/.out-net
NET=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/net
COROUTINES="$(find "$KOTLIN_HOME" -name 'kotlinx-coroutines-core-jvm*.jar' | head -1)"
[ -n "$COROUTINES" ] || { echo "checks: kotlinx-coroutines-core-jvm.jar not found in $KOTLIN_HOME" >&2; exit 127; }
mkdir -p "$OUT_NET"

check_operator_401() {
  "$KOTLINC" -nowarn -cp "$JSON_JAR:$COROUTINES" -d "$OUT_NET" \
    "$CORE"/TagLink.kt "$CORE"/ApiFailure.kt "$CORE"/MaterialQueue.kt "$CORE"/Wire.kt "$CORE"/Zones.kt \
    "$CORE"/PendingWork.kt "$CORE"/SyncPlan.kt "$CORE"/SessionCookie.kt \
    checks/fake/build-config.kt checks/fake/android-content.kt \
    "$NET"/CookieJar.kt "$NET"/OperatorSession.kt "$NET"/Api.kt checks/operator-401-check.kt &&
  "$JAVA_BIN" -cp "$OUT_NET:$JSON_JAR:$STDLIB:$COROUTINES" io.github.qwadratic.nfctimesheets.checks.Operator401Check
}

# ---- run them all, red or not ------------------------------------------------------
set +e
failed=0
results=""
step() {          # step <name> <function>
  local name="$1" fn="$2"
  echo
  echo "=== $name ==="
  if "$fn"; then
    results="$results\nok    $name"
  else
    results="$results\nFAIL  $name"
    failed=1
  fi
}

step core            check_core
step known-tags      check_known_tags
step tag-writer      check_tag_writer
step raw-tag-io      check_raw_tag_io
step manifest        check_manifest
step verify-no-shift check_verify_no_shift
step reader-armed    check_reader_armed
step operator-401    check_operator_401

echo
echo "=== summary ==="
printf '%b\n' "${results#\\n}"
if [ "$failed" -ne 0 ]; then
  echo "checks: FAILED" >&2
  exit 1
fi
echo "checks: OK"
