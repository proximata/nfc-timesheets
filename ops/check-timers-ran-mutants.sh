#!/usr/bin/env bash
#
# SHOW ops/check-timers-ran.sh RED, BY RE-CREATING THE OUTAGE IT EXISTS TO CATCH.
#
#     ./ops/check-timers-ran-mutants.sh [host]
#
# Not a mutated copy of the script — the ACTUAL FAULT, on the actual box, reverted after.
# Every mutant below is a state production was genuinely in at some point, or one ops/deploy.sh
# can put it in tomorrow:
#
#   1  postgres leaves the `app` group      -> exactly 2026-07-28. The unit cannot open its
#                                              SQL file; the 8h net silently stops existing.
#   2  the SQL file is made unreadable      -> the same outage arriving via a mode bit rather
#                                              than a group; a deploy that rsyncs 0600 does this.
#   3  the last execution exits non-zero    -> the unit ran and failed. list-timers stays green.
#   4  the timer is stopped                 -> the unit's last run still exited 0 and it is not
#                                              failed, so only the freshness arm can catch it.
#
# Mutant 1 is the load-bearing one: through the whole six-day outage, `systemctl list-timers`
# said nfc-autoclose fired minutes ago, every time.
#
# EVERY MUTANT IS REVERTED IN A TRAP, and the script re-runs the check green at the end. If
# it is killed between apply and revert, the revert is one line and is printed on the way in.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
CHECK="$REPO/ops/check-timers-ran.sh"
SQL=/srv/nfc/ops/sql/autoclose.sql

FAILED=0
ok()  { printf '  ok:   %s\n' "$1"; }
bad() { printf '  FAIL: %s\n' "$1"; FAILED=1; }

revert_all() {
  ssh "$HOST" "sudo gpasswd -a postgres app >/dev/null 2>&1; \
               sudo chmod 0640 $SQL; \
               sudo systemctl start nfc-autoclose.timer >/dev/null 2>&1; \
               sudo systemctl start nfc-autoclose >/dev/null 2>&1" >/dev/null 2>&1
}
trap 'revert_all' EXIT

echo "mutating $HOST to show ops/check-timers-ran.sh red"
echo "  (manual revert, if this is killed: ssh $HOST \"sudo gpasswd -a postgres app; sudo chmod 0640 $SQL; sudo systemctl start nfc-autoclose.timer\")"

# A mutant must make the check fail AND fail for the right reason. A check that goes red
# because ssh broke has proved nothing about the check.
mutant() {
  local name="$1" apply="$2" expect="$3" revert="$4"
  printf '\n-- mutant: %s\n' "$name"
  ssh "$HOST" "$apply" >/dev/null 2>&1
  local out rc
  out=$("$CHECK" "$HOST" 2>&1); rc=$?
  ssh "$HOST" "$revert" >/dev/null 2>&1
  if [ "$rc" -eq 0 ]; then
    bad "$name: the check still PASSED — it does not detect this"
    return
  fi
  if printf '%s' "$out" | /usr/bin/grep -qF "$expect"; then
    ok "RED for the right reason: $(printf '%s' "$out" | /usr/bin/grep -F "$expect" | head -1 | sed 's/^ *//')"
  else
    bad "$name: the check failed, but not with '$expect'. It said: $(printf '%s' "$out" | /usr/bin/grep 'FAIL:' | head -1)"
  fi
}

# 1 — THE REAL OUTAGE. Take postgres back out of the app group, exactly as it was before
#     2026-08-03, and confirm the check names the file the unit can no longer read.
mutant "postgres leaves the app group (the 2026-07-28 outage)" \
  "sudo gpasswd -d postgres app" \
  "CANNOT READ /srv/nfc/ops/sql/autoclose.sql" \
  "sudo gpasswd -a postgres app"

# 2 — the same outage via a mode bit. A deploy that rsyncs the file 0600 is one --chmod away.
mutant "autoclose.sql becomes 0600" \
  "sudo chmod 0600 $SQL" \
  "CANNOT READ /srv/nfc/ops/sql/autoclose.sql" \
  "sudo chmod 0640 $SQL"

# 3 — the unit RAN and FAILED. This is what systemd recorded 555 times while list-timers
#     stayed green. Reproduced by actually running it against an unreadable file, so the
#     recorded ExecMainStatus is a genuine one and not a fabricated property.
mutant "the last execution exits non-zero" \
  "sudo chmod 0600 $SQL; sudo systemctl start nfc-autoclose; sudo chmod 0640 $SQL" \
  "its last execution exited 1" \
  "sudo systemctl start nfc-autoclose"

# 4 — the timer is stopped. The unit is not failed and its last run exited 0, so arms (1)
#     and (2) are both green; only freshness can see this. Proven by asking for a ceiling of
#     zero seconds rather than by waiting an hour, which is the same arithmetic.
printf '\n-- mutant: %s\n' "the timer has not fired inside its window"
# Written to a FILE beside the original rather than piped into `bash -s`: the check resolves
# its own directory from BASH_SOURCE[0], which is unbound when the script arrives on stdin
# under `set -u`, so the piped form died before reaching a single assertion.
MUT="$REPO/ops/.check-timers-ran.mutant.sh"
trap 'revert_all; rm -f "$MUT"' EXIT
sed 's/^AUTOCLOSE_MAX_AGE_S=.*/AUTOCLOSE_MAX_AGE_S=0/' "$CHECK" > "$MUT"
out=$(bash "$MUT" "$HOST" 2>&1); rc=$?
rm -f "$MUT"
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -q 'past the 0s ceiling'; then
  ok "RED for the right reason: $(printf '%s' "$out" | /usr/bin/grep 'past the 0s ceiling' | head -1 | sed 's/^ *//')"
else
  bad "a zero-second freshness ceiling did not make the check red"
fi

# --- and green again, with everything reverted -------------------------------------------
printf '\n-- restored\n'
if "$CHECK" "$HOST" >/dev/null 2>&1; then
  ok "the box is back as it was found and the check is green"
else
  bad "the check is STILL RED after the revert — the box has been left broken"
fi

echo
[ "$FAILED" -eq 0 ] && { echo "CHECK-TIMERS-RAN-MUTANTS OK — 5 red, restored, green"; exit 0; }
echo "CHECK-TIMERS-RAN-MUTANTS FAILED"; exit 1
