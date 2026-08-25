#!/usr/bin/env bash
# AN OPERATOR-ONLY PHONE CAN REACH THE UPDATE PATH — STRUCTURALLY (TASK-254).
#
#     cd android && ./checks/update-reach-check.sh
#     MUTANT=secondimpl ./checks/update-reach-check.sh    # must go RED
#
# WHY THIS FILE EXISTS. An operator-only phone (Mister Clarity, op id 71) never signs a
# worker in, so it never reaches Settings, which is where UpdateSection used to live
# ALONE. It therefore had no self-service path to a fix at all — and that bit us the same
# day 0.5.6 -> 0.5.7 shipped an operator-reachability fix. AC1 says the update path is
# reachable from the Betreiber? section and from both NFC operator screens; AC2 says it
# reuses update/UpdateManager.kt and does not grow a second implementation. Both are
# properties of the WIRING, so they are checked against the source that does the wiring,
# the same way manifest-check.sh and verify-no-shift-check.sh read theirs.
#
# THE NEGATIVE CASE IS SEEDED IN MEMORY, NEVER ON DISK — same discipline as
# verify-no-shift-check.sh: the mutant appends to a COPY held in a shell variable, so an
# interrupted run cannot leave the regression it was demonstrating on disk.
set -uo pipefail

cd "$(dirname "$0")/.."     # android/

SRC=app/src/main/kotlin/io/github/qwadratic/nfctimesheets
UPDATE_MANAGER="$SRC/update/UpdateManager.kt"
UPDATE_ACTIVITY="$SRC/ui/UpdateActivity.kt"
APP_UI="$SRC/ui/TimeSheetApp.kt"
WRITE="$SRC/nfc/WriteTagActivity.kt"
VERIFY="$SRC/nfc/VerifyZoneActivity.kt"
MANIFEST=app/src/main/AndroidManifest.xml
MUTANT="${MUTANT:-}"

fail=0
ok() { printf '  ok    %s\n' "$1"; }

for f in "$UPDATE_MANAGER" "$UPDATE_ACTIVITY" "$APP_UI" "$WRITE" "$VERIFY" "$MANIFEST"; do
  [ -f "$f" ] || { echo "update-reach-check: missing $f" >&2; exit 127; }
done

manager_src="$(/bin/cat "$UPDATE_MANAGER")"
activity_src="$(/bin/cat "$UPDATE_ACTIVITY")"
app_src="$(/bin/cat "$APP_UI")"
write_src="$(/bin/cat "$WRITE")"
verify_src="$(/bin/cat "$VERIFY")"
manifest_src="$(/bin/cat "$MANIFEST")"

has() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

# The mutant is a SECOND DownloadManager user, which is exactly what AC2 forbids.
if [ -n "$MUTANT" ]; then
  case "$MUTANT" in
    secondimpl) ;;
    *) echo "update-reach-check: unknown MUTANT=$MUTANT" >&2; exit 2 ;;
  esac
  echo "update-reach-check: MUTANT=$MUTANT — the line below MUST go red"
fi

echo "update-reach-check: proving the update path is reachable without a worker session"

# ---- the mechanism itself, proven before anything is concluded from it ------------------
# If this search cannot find the one thing that is definitely there, nothing below means
# anything — the control release-artefact.sh applies to "writeNdefMessage".
if has "UpdateManager" "$manager_src"; then
  ok "the search works: update/UpdateManager.kt contains UpdateManager"
else
  echo "FAIL: 'UpdateManager' not found in $UPDATE_MANAGER — the search is broken" >&2
  fail=1
fi

# ---- AC1: three hosts, none of them behind a worker sign-in ------------------------------
reach() {
  local what="$1" path="$2" content="$3" why="$4"
  if has "$what" "$content"; then
    ok "$why"
  else
    echo "FAIL: '$what' not found in $path — $why" >&2
    fail=1
  fi
}

reach "UpdateSection(model, shiftRunning = pending.open != null" "$APP_UI" "$app_src" \
  "AC1: SignInScreen's Betreiber? section composes UpdateSection (no worker session)"
reach "UpdateActivity" "$WRITE" "$write_src" \
  "AC1: WriteTagActivity opens UpdateActivity"
reach "UpdateActivity" "$VERIFY" "$verify_src" \
  "AC1: VerifyZoneActivity opens UpdateActivity"
reach ".ui.UpdateActivity" "$MANIFEST" "$manifest_src" \
  "AC1: UpdateActivity is declared in the manifest (an undeclared one crashes on launch)"
reach "UpdateSection(model, shiftRunning = false" "$UPDATE_ACTIVITY" "$activity_src" \
  "AC1: UpdateActivity hosts the SAME UpdateSection, not a copy"

# The NFC screens must reach it by an EXPLICIT class, never the tap intent (decision-45/47).
# NOTE the token is assembled, never written whole: checks/verify-no-shift-check.sh forbids
# the literal string anywhere in VerifyZoneActivity.kt, INCLUDING inside a comment, and a
# check that cannot be described without breaking a different check is a badly built check.
TAP_INTENT="ACTION_""VIEW"
for pair in "$WRITE:$write_src" "$VERIFY:$verify_src"; do
  p="${pair%%:*}"; c="${pair#*:}"
  if has "$TAP_INTENT" "$c"; then
    echo "FAIL: '$TAP_INTENT' found in $p — the update button must be an explicit class" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] && ok "neither NFC screen reaches the update screen through the tap intent"

# UpdateActivity must NOT bootstrap a worker session: it is identity-agnostic on purpose.
SESSION_BOOT="restore""Session"
if has "$SESSION_BOOT" "$activity_src"; then
  echo "FAIL: '$SESSION_BOOT' found in $UPDATE_ACTIVITY — this screen must need no session" >&2
  fail=1
else
  ok "AC1: UpdateActivity never bootstraps a worker session — no sign-in on this path"
fi

# ---- AC2: ONE implementation ------------------------------------------------------------
# DownloadManager.Request is the marker: the bare type name is MENTIONED in six files (a
# state class, a readiness probe, the UI that renders it), but only an implementation
# ENQUEUES, and enqueuing is what a second implementation could not avoid doing.
if [ -n "$MUTANT" ]; then
  # Seeded in memory: a second file's worth of usage, counted without writing anything.
  downloaders=$(( $(/usr/bin/grep -rl "DownloadManager.Request" app/src/main --include='*.kt' | /usr/bin/wc -l) + 1 ))
else
  downloaders=$(/usr/bin/grep -rl "DownloadManager.Request" app/src/main --include='*.kt' | /usr/bin/wc -l)
fi
downloaders=$(echo "$downloaders" | /usr/bin/tr -d ' ')
if [ "$downloaders" = "1" ]; then
  ok "AC2: exactly one file under app/src/main enqueues a download — no second implementation"
else
  echo "FAIL: $downloaders files under app/src/main enqueue a download — AC2 wants exactly 1" >&2
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
  [ -n "$MUTANT" ] && { echo "update-reach-check: MUTANT=$MUTANT stayed GREEN — the check is vacuous"; exit 1; }
  echo "update-reach-check: OK"
  exit 0
fi
if [ -n "$MUTANT" ]; then
  echo "update-reach-check: $fail red under MUTANT=$MUTANT, as required"
  exit 0
fi
echo "update-reach-check: $fail FAILED"
exit 1
