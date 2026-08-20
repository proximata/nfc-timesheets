#!/usr/bin/env bash
#
# SHOW ops/check-unit-drift.sh RED, BY PUTTING THE BOX BACK IN THE STATE IT WAS FOUND IN.
#
#     ./ops/check-unit-drift-mutants.sh [host]
#
# Every mutant here is not an invention: it is the EXACT unit file that was serving production
# up to 2026-08-20, restored from /root/nfc-api.service.before-break-run and reverted. If a
# check cannot go red against the real historical fault, it is decoration.
#
#   1  the pre-2026-08-20 unit, whole      -> drift on ExecStart AND User, plus a running
#                                             process with no --import and running as exedev
#   2  --import dropped, everything else kept -> the SILENT one. Everything serves, /health is
#                                             200, every other check in this repo passes, and
#                                             telemetry is simply never there.
#   3  the file edited WITHOUT daemon-reload -> systemd still runs the old unit. A check that
#                                             reads /etc/systemd/system off disk goes green here.
#
# Mutant 3 is why this check reads `systemctl cat` and /proc/<pid>/cmdline rather than a file.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
CHECK="$REPO/ops/check-unit-drift.sh"
UNIT=/etc/systemd/system/nfc-api.service

FAILED=0
ok()  { printf '  ok:   %s\n' "$1"; }
bad() { printf '  FAIL: %s\n' "$1"; FAILED=1; }

# The good unit, saved on the box before the first mutation, so the revert never depends on
# this laptop still being reachable.
restore() {
  ssh "$HOST" "sudo install -m 0644 -o root -g root /root/nfc-api.service.good $UNIT >/dev/null 2>&1; \
               sudo systemctl daemon-reload; sudo systemctl restart nfc-api" >/dev/null 2>&1
  sleep 3
}
trap 'restore' EXIT

scp -q ops/systemd/nfc-api.service "$HOST:/tmp/good.service"
ssh "$HOST" "sudo install -m 0644 -o root -g root /tmp/good.service /root/nfc-api.service.good && rm /tmp/good.service" >/dev/null 2>&1

echo "mutating the nfc-api unit on $HOST to show ops/check-unit-drift.sh red"
echo "  (manual revert: ssh $HOST \"sudo cp /root/nfc-api.service.good $UNIT; sudo systemctl daemon-reload; sudo systemctl restart nfc-api\")"

mutant() {
  local name="$1" apply="$2" expect="$3"
  printf '\n-- mutant: %s\n' "$name"
  ssh "$HOST" "$apply" >/dev/null 2>&1
  sleep 3
  local out rc
  out=$("$CHECK" "$HOST" 2>&1); rc=$?
  restore
  if [ "$rc" -eq 0 ]; then bad "$name: the check still PASSED"; return; fi
  if printf '%s' "$out" | /usr/bin/grep -qF "$expect"; then
    ok "RED for the right reason: $(printf '%s' "$out" | /usr/bin/grep -F "$expect" | head -1 | sed 's/^ *//')"
  else
    bad "$name: red, but not with '$expect'. It said: $(printf '%s' "$out" | /usr/bin/grep 'FAIL:' | head -1)"
  fi
}

# 1 — THE ACTUAL PRODUCTION UNIT, as found. Kept at /root by ops/break-infra.sh's run.
if ssh "$HOST" "sudo test -f /root/nfc-api.service.before-break-run"; then
  mutant "the unit production was actually running until 2026-08-20" \
    "sudo install -m 0644 -o root -g root /root/nfc-api.service.before-break-run $UNIT && sudo systemctl daemon-reload && sudo systemctl restart nfc-api" \
    "NO --import"
else
  bad "the pre-break unit is not saved at /root/nfc-api.service.before-break-run — mutant 1 cannot run"
fi

# 2 — THE SILENT ONE. Only the flag removed. Nothing else changes; nothing else notices.
mutant "--import dropped, everything else identical" \
  "sudo sed -i 's|^ExecStart=.*|ExecStart=/usr/bin/node /srv/nfc/server.js|' $UNIT && sudo systemctl daemon-reload && sudo systemctl restart nfc-api" \
  "NO --import"

# 3 — the file changed, systemd NOT reloaded. `systemctl cat` reads the file, so the directive
#     comparison DOES see it; the running process still carries the old argv, so the cmdline
#     arm sees it too. Either way it must not be green — a hand edit that nobody reloaded is
#     a box whose file and whose behaviour disagree, and that is the state to catch.
mutant "the unit file edited but systemd never reloaded" \
  "sudo sed -i 's|^User=app|User=exedev|' $UNIT" \
  "DRIFTS from ops/systemd/nfc-api.service"

printf '\n-- restored\n'
if "$CHECK" "$HOST" >/dev/null 2>&1; then
  ok "the unit is back and the check is green"
else
  bad "the check is STILL RED after the revert — the box has been left drifted"
fi
HEALTH=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "https://$HOST/health" 2>/dev/null)
[ "$HEALTH" = "200" ] && ok "and the API is serving ($HEALTH)" || bad "the API answers $HEALTH after the mutants"

echo
[ "$FAILED" -eq 0 ] && { echo "CHECK-UNIT-DRIFT-MUTANTS OK — 3 red, restored, green"; exit 0; }
echo "CHECK-UNIT-DRIFT-MUTANTS FAILED"; exit 1
