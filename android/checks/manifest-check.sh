#!/usr/bin/env bash
# THE MANIFEST OBLIGATIONS THE COMPILER CANNOT SEE.
#
#     cd android && ./checks/manifest-check.sh          # green
#     MUTANT=perm     ./checks/manifest-check.sh        # each of these must go RED
#     MUTANT=service  ./checks/manifest-check.sh
#     MUTANT=boot     ./checks/manifest-check.sh
#     MUTANT=bind     ./checks/manifest-check.sh
#
# WHY THIS FILE EXISTS, and it is not a style rule.
#
# `sync/SyncScheduler.kt` builds a JobInfo with `setRequiredNetworkType(...)`. That single
# call puts an obligation on a file in another language two directories away: the manifest
# must declare `android.permission.ACCESS_NETWORK_STATE`, or `JobScheduler.schedule()`
# throws
#
#     SecurityException: android.permission.ACCESS_NETWORK_STATE required for jobs
#                        with a connectivity constraint
#
# The app declared INTERNET and not that one. Kotlin compiled. Lint said nothing. R8 said
# nothing. `android/checks/run.sh` said OK — it reads `core/`, which is Android-free by
# design and therefore cannot contain this bug or see it. The release APK installed and
# ran. And the entire background-push half of TASK-225 was dead on every device it had
# ever been installed on: a cleaner's basement tap sat on the phone exactly as it had
# before the feature was written.
#
# It was caught by asking a REAL DEVICE (`demo/prove-offline-push.mjs`), which is the only
# instrument that can answer this — and this file exists so that nobody has to boot an
# emulator to catch it a second time.
#
# THE RULE, stated as the check performs it: if the source asks the platform for a
# connectivity constraint, the manifest must hold the permission that constraint requires.
# Deleting either side must fail. That is what MUTANT=perm proves.
set -uo pipefail

cd "$(dirname "$0")/.."     # android/

MANIFEST=app/src/main/AndroidManifest.xml
SCHEDULER=app/src/main/kotlin/io/github/qwadratic/nfctimesheets/sync/SyncScheduler.kt
MUTANT="${MUTANT:-}"

fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }
check() { if [ "$1" = 1 ]; then ok "$2"; else bad "$2"; fi; }

manifest="$(/bin/cat "$MANIFEST")"
scheduler="$(/bin/cat "$SCHEDULER")"

# The mutants edit the STRINGS this run reads, never the files on disk. A check that
# rewrites a source file to prove itself is one interrupted run away from committing the
# bug it was demonstrating.
case "$MUTANT" in
  perm)    manifest="${manifest//android.permission.ACCESS_NETWORK_STATE/android.permission.NOTHING_LIKE_IT}" ;;
  service) manifest="${manifest//.sync.ShiftSyncJob/.sync.NotDeclared}" ;;
  boot)    manifest="${manifest//android.permission.RECEIVE_BOOT_COMPLETED/android.permission.NOTHING_LIKE_IT}" ;;
  bind)    manifest="${manifest//android.permission.BIND_JOB_SERVICE/android.permission.NOTHING_LIKE_IT}" ;;
  "")      ;;
  *)       echo "manifest-check: unknown MUTANT=$MUTANT" >&2; exit 2 ;;
esac
[ -n "$MUTANT" ] && echo "manifest-check: MUTANT=$MUTANT — the lines below MUST go red"

has() { case "$2" in *"$1"*) return 0 ;; *) return 1 ;; esac; }

echo "manifest-check: the obligations sync/SyncScheduler.kt puts on $MANIFEST"

# 1. THE ONE THAT SHIPPED BROKEN. Conditional on the source, not unconditional: if the
#    connectivity constraint is ever dropped the permission may go too, and this check
#    must not then demand a permission nothing needs.
if has "setRequiredNetworkType" "$scheduler"; then
  check "$(has 'android.permission.ACCESS_NETWORK_STATE' "$manifest" && echo 1 || echo 0)" \
    "SyncScheduler asks for a connectivity constraint, so the manifest holds ACCESS_NETWORK_STATE"
else
  ok "SyncScheduler no longer asks for a connectivity constraint — permission not required"
fi

# 2. setPersisted(true) is what carries a queued shift across a reboot, and it throws
#    without this permission in exactly the same silent way.
if has "setPersisted(true)" "$scheduler"; then
  check "$(has 'android.permission.RECEIVE_BOOT_COMPLETED' "$manifest" && echo 1 || echo 0)" \
    "the job is setPersisted(true), so the manifest holds RECEIVE_BOOT_COMPLETED"
fi

# 3. A ComponentName pointing at a service the manifest does not declare is a schedule()
#    that fails — again by return value, again silently.
check "$(has '.sync.ShiftSyncJob' "$manifest" && echo 1 || echo 0)" \
  "the JobService the scheduler names is declared: <service android:name=\".sync.ShiftSyncJob\">"

# 4. The platform REFUSES to bind a JobService without this, and it is also the security
#    property: only the system holds BIND_JOB_SERVICE, so nothing else can start a push.
check "$(has 'android.permission.BIND_JOB_SERVICE' "$manifest" && echo 1 || echo 0)" \
  "…with android:permission=\"android.permission.BIND_JOB_SERVICE\""

# 5. The refusal must not be swallowed again. `runCatching { scheduler.schedule(job) }`
#    discards BOTH a thrown SecurityException and a returned RESULT_FAILURE, which is how
#    this shipped dead and green. The result must be compared, and the comparison must
#    reach a type the UI can render.
check "$(has 'JobScheduler.RESULT_SUCCESS' "$scheduler" && echo 1 || echo 0)" \
  "schedule()'s RETURN VALUE is compared, not discarded — RESULT_FAILURE is not an exception"
check "$(has 'Armed.Refused' "$scheduler" && echo 1 || echo 0)" \
  "…and a refusal becomes a value the screen can show, not a swallowed throw"

echo
if [ "$fail" -eq 0 ]; then
  [ -n "$MUTANT" ] && { echo "manifest-check: MUTANT=$MUTANT stayed GREEN — the check is vacuous"; exit 1; }
  echo "manifest-check: OK"
  exit 0
fi
if [ -n "$MUTANT" ]; then
  echo "manifest-check: $fail red under MUTANT=$MUTANT, as required"
  exit 0
fi
echo "manifest-check: $fail FAILED"
exit 1
