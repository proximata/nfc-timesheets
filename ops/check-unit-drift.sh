#!/usr/bin/env bash
#
# THE UNIT FILE IN THIS REPO MUST BE THE UNIT FILE ON THE BOX.
#
#     ./ops/check-unit-drift.sh [host]
#
# WHY. ops/systemd/nfc-api.service was a DOCUMENT for as long as this project has existed:
# nothing installed it, nothing compared it, and ops/deploy.sh never mentioned it. On
# 2026-08-20 the two were measured against each other for the first time and they disagreed
# about the two lines that matter most:
#
#   repo  ExecStart=/usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js
#   box   ExecStart=/usr/bin/node /srv/nfc/server.js
#   repo  User=app
#   box   User=exedev
#
# Neither is cosmetic.
#
#   --import missing  instrument.mjs was NEVER LOADED. The Sentry SDK was not merely
#                     disabled for want of a DSN, it was absent from the process — so the
#                     one action everyone believed would turn telemetry on (set SENTRY_DSN
#                     and restart) would have produced exactly nothing, and the next person
#                     to look would have concluded Sentry itself was broken. Confirmed by
#                     reading /proc/<pid>/cmdline, not by reading a file.
#
#   User=exedev       the API ran as a sudo-group account with a login shell, for months.
#                     ops/deploy.sh's own comment describes precisely why it must not:
#                     "app is a --system user with no shell and no sudo: if the API is ever
#                     popped, it cannot rewrite its own code, and it cannot escalate the way
#                     the sudo-group exedev could."
#
# A drift check that reads /etc/systemd/system/*.service off disk is not enough — systemd
# runs what it LOADED, and a file edited without `daemon-reload` is a third state that looks
# right on disk and is not running. So this compares the repo against `systemctl cat` (what
# systemd has loaded) AND against the actual running process's /proc/<pid>/cmdline.
#
# SHOW IT RED:  ./ops/check-unit-drift-mutants.sh
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"

FAILED=0
ok()  { printf '  ok:   %s\n' "$1"; }
bad() { printf '  FAIL: %s\n' "$1"; FAILED=1; }

echo "comparing ops/systemd/*.service with what systemd on $HOST has actually loaded"

# `systemctl cat` prints a `# /etc/systemd/system/x.service` provenance header and any
# drop-ins. Strip comments and blank lines from BOTH sides: this is about directives, not
# about whether somebody reflowed a comment.
directives() { /usr/bin/grep -vE '^\s*(#|;|$)' | sed 's/[[:space:]]*$//'; }

for unit in nfc-api nfc-autoclose.service nfc-autoclose.timer nfc-backup.service nfc-backup.timer; do
  file="ops/systemd/${unit%.service}.service"
  case "$unit" in *.timer) file="ops/systemd/$unit" ;; esac
  [ -f "$file" ] || { bad "$unit: no file at $file to compare against"; continue; }

  want=$(directives < "$file")
  got=$(ssh "$HOST" "systemctl cat $unit" 2>/dev/null | directives)
  if [ -z "$got" ]; then
    bad "$unit: systemd on $HOST has nothing loaded under that name"
    continue
  fi
  if [ "$want" = "$got" ]; then
    ok "$unit matches $file directive for directive"
  else
    bad "$unit DRIFTS from $file:"
    diff <(printf '%s\n' "$want") <(printf '%s\n' "$got") | sed 's/^/        /'
  fi
done

# ---- and what is ACTUALLY RUNNING, which a file on disk does not prove -------------------
#
# A unit edited without `daemon-reload`, or reloaded without `restart`, leaves the old
# process running. Both of those states pass every comparison above.
PID=$(ssh "$HOST" "systemctl show nfc-api -p MainPID --value" 2>/dev/null)
if [ -z "$PID" ] || [ "$PID" = "0" ]; then
  bad "nfc-api is not running on $HOST"
else
  CMD=$(ssh "$HOST" "tr '\\0' ' ' < /proc/$PID/cmdline" 2>/dev/null)
  WANT_EXEC=$(/usr/bin/grep '^ExecStart=' ops/systemd/nfc-api.service | sed 's/^ExecStart=//')
  # The running argv, normalised to one space, must be the ExecStart the repo names.
  GOT=$(printf '%s' "$CMD" | tr -s ' ' | sed 's/ $//')
  if [ "$GOT" = "$WANT_EXEC" ]; then
    ok "the running process's argv IS the repo's ExecStart: $GOT"
  else
    bad "the RUNNING process does not match the repo's ExecStart (a daemon-reload without a restart looks fine on disk):"
    printf '        repo:    %s\n        running: %s\n' "$WANT_EXEC" "$GOT"
  fi

  # --import is called out separately because it is the one flag whose absence is SILENT:
  # everything serves, every check passes, and telemetry is simply never there.
  case "$CMD" in
    *--import*instrument.mjs*) ok "instrument.mjs is loaded via --import, so a DSN would actually take effect" ;;
    *) bad "the running process has NO --import: setting SENTRY_DSN would change nothing" ;;
  esac

  RUNAS=$(ssh "$HOST" "ps -o user= -p $PID" 2>/dev/null | tr -d ' ')
  WANT_USER=$(/usr/bin/grep '^User=' ops/systemd/nfc-api.service | sed 's/^User=//')
  [ "$RUNAS" = "$WANT_USER" ] \
    && ok "the API runs as '$RUNAS' — a nologin system account, as ops/deploy.sh's own comment requires" \
    || bad "the API runs as '$RUNAS', the repo says '$WANT_USER'"
  case "$RUNAS" in
    exedev|root) bad "'$RUNAS' has a login shell and sudo. A compromised API could rewrite its own code and escalate." ;;
  esac
fi

echo
[ "$FAILED" -eq 0 ] && { echo "CHECK-UNIT-DRIFT OK — $HOST"; exit 0; }
echo "CHECK-UNIT-DRIFT FAILED — $HOST"; exit 1
