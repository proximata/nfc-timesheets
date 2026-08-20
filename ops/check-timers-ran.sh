#!/usr/bin/env bash
#
# AN ENABLED TIMER PROVES NOTHING. ASSERT THE SERVICE RAN.
#
#     ./ops/check-timers-ran.sh [host]
#
# WHY THIS FILE EXISTS, and it is not hypothetical.
#
# `nfc-autoclose.service` runs as `User=postgres` and reads /srv/nfc/ops/sql/autoclose.sql,
# which ops/deploy.sh rsyncs as 0640 exedev:app under 0750 directories. Between
# 2026-07-28T17:45Z and 2026-08-03T12:15Z the `postgres` role was not in the `app` group, so
# psql could not OPEN the file. It exited 1. systemd marked the unit failed. It did that
# **555 consecutive times over six days**, and the 8h auto-close safety net — the thing
# decision-10 promises stops a forgotten tap-out becoming unbounded payroll hours — did not
# exist for that week.
#
# Nothing noticed. `systemctl list-timers` was green the whole time, because a timer's health
# is whether it FIRED, not whether what it fired succeeded. `systemctl status nfc-autoclose`
# would have said `failed` in red, and nobody typed it. The group was fixed at some point on
# 2026-08-03 by a hand that left no commit and no note; the membership is not in
# ops/deploy.sh, is not in the unit file, and is not in the provisioning runbook, so the next
# rebuild of this VM restores the outage exactly.
#
# So this asserts three things per timer, and each one alone is insufficient:
#
#   1. the unit is not currently in a failed state
#   2. its LAST EXECUTION exited 0                (`ExecMainStatus`)
#   3. it has actually run inside its own window  (`LAST` from list-timers, vs a max age)
#
# (1) alone misses a unit that has never run. (2) alone misses a unit whose timer is dead.
# (3) alone is what was green through the whole six-day outage.
#
# And it asserts the PRECONDITION that broke, directly: the role the unit runs as can read
# the file the unit reads. That is the check that would have gone red on 2026-07-28.
#
# SHOW IT RED:  ./ops/check-timers-ran-mutants.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"

FAILED=0
ok()      { printf '  ok:   %s\n' "$1"; }
bad()     { printf '  FAIL: %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

# How stale a successful run may be before it is a fault. The autoclose timer is every 15
# minutes and the backup is daily; both get generous slack for a boot or a clock skew.
AUTOCLOSE_MAX_AGE_S=$((60 * 60))          # 1h — four missed firings
BACKUP_MAX_AGE_S=$((36 * 60 * 60))        # 36h — one missed day

now_box=$(ssh "$HOST" 'date +%s') || { echo "FATAL: cannot reach $HOST" >&2; exit 1; }

check_timer() {
  local unit="$1" max_age="$2"
  section "$unit"

  local state
  state=$(ssh "$HOST" "systemctl is-failed $unit.service" 2>/dev/null)
  [ "$state" = "failed" ] \
    && bad "$unit.service is in the FAILED state right now" \
    || ok "$unit.service is not failed (is-failed: $state)"

  # The exit status of the LAST execution. `n/a` means it has never run at all, which for a
  # unit whose whole job is to run on a timer is a failure and not an unknown.
  local rc
  rc=$(ssh "$HOST" "systemctl show $unit.service -p ExecMainStatus --value" 2>/dev/null)
  case "$rc" in
    0)   ok "its last execution exited 0" ;;
    ""|n/a) bad "$unit.service has NEVER executed — the timer has never actually done anything" ;;
    *)   bad "its last execution exited $rc — the job did not do its work" ;;
  esac

  # And that the last execution was recent. A unit that succeeded once in July and whose
  # timer has been dead since satisfies both checks above.
  local last_iso last_epoch age
  last_iso=$(ssh "$HOST" "systemctl show $unit.timer -p LastTriggerUSec --value" 2>/dev/null)
  if [ -z "$last_iso" ] || [ "$last_iso" = "n/a" ]; then
    bad "$unit.timer has never triggered"
    return
  fi
  last_epoch=$(ssh "$HOST" "date -d '$last_iso' +%s" 2>/dev/null)
  if [ -z "$last_epoch" ]; then
    bad "could not read a trigger time out of '$last_iso'"
    return
  fi
  age=$((now_box - last_epoch))
  if [ "$age" -le "$max_age" ]; then
    ok "it last fired ${age}s ago (ceiling ${max_age}s)"
  else
    bad "it last fired ${age}s ago, which is past the ${max_age}s ceiling — the timer is not running"
  fi
}

echo "asserting the background jobs on $HOST have RUN, not merely been enabled"

check_timer nfc-autoclose "$AUTOCLOSE_MAX_AGE_S"
check_timer nfc-backup    "$BACKUP_MAX_AGE_S"

# =========================================================================================
section "the precondition that broke, asserted directly"
#
# `sudo -u <User> test -r <file>` for the exact user and the exact path in the unit. Not a
# permissions calculation from the mode bits — the actual open, by the actual role. This is
# the line that would have gone red on 2026-07-28T17:45Z.
# ONE PROPERTY PER CALL. `systemctl show -p User -p ExecStart --value` prints them in the
# unit file's own order, not the order asked for, so `head -1` picked up the ExecStart blob
# and tried to `sudo -u` a shell-quoted struct.
for unit in nfc-autoclose nfc-backup; do
  user=$(ssh "$HOST" "systemctl show $unit.service -p User --value" 2>/dev/null)
  [ -n "$user" ] || user=root
  exec_line=$(ssh "$HOST" "systemctl show $unit.service -p ExecStart --value" 2>/dev/null)
  # The file the unit reads: the last .sql/.sh path on the ExecStart line.
  file=$(printf '%s\n' "$exec_line" | tr ' ' '\n' | /usr/bin/grep -oE '/[A-Za-z0-9._/-]+\.(sql|sh)' | tail -1)
  if [ -z "$file" ]; then
    ok "$unit: no file argument to check"
    continue
  fi
  if ssh "$HOST" "sudo -u $user test -r '$file'" 2>/dev/null; then
    ok "$unit: user '$user' can read $file"
  else
    bad "$unit: user '$user' CANNOT READ $file — this unit is dead and its timer will not say so"
  fi
done

# The undocumented group membership that is currently the only reason the above passes.
GROUPS_LINE=$(ssh "$HOST" "id -nG postgres" 2>/dev/null)
case " $GROUPS_LINE " in
  *" app "*) ok "postgres is in the 'app' group — which is what ended the six-day outage, and is recorded NOWHERE in this repo except here" ;;
  *) bad "postgres is NOT in the 'app' group; it reads deploy-owned files as $GROUPS_LINE" ;;
esac

echo
[ "$FAILED" -eq 0 ] && { echo "CHECK-TIMERS-RAN OK — $HOST"; exit 0; }
echo "CHECK-TIMERS-RAN FAILED — $HOST"; exit 1
