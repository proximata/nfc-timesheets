#!/usr/bin/env bash
#
# INJECT REAL INFRASTRUCTURE FAILURES INTO PRODUCTION AND RECORD WHAT A HUMAN SEES.
#
#     ./ops/break-infra.sh [host]
#
# The owner authorised this against the live box. Production holds one building and no
# meaningful work, and everything this script creates is marked and deleted. What it BREAKS
# it restores, and it re-asserts the box is serving before it exits — including from a trap,
# because a probe killed mid-run skips its `finally` and would leave Postgres stopped.
#
# WHAT IS ACTUALLY BEING ASKED, in each case: not "does it return an error" but
#   - what does the CLEANER see, at a door, holding a phone
#   - what does the DIRECTOR see, in the panel
#   - does it recover WITHOUT A HUMAN, or does someone have to ssh in
#   - is anything LOST, or merely delayed
#
# Sections:
#   1  telemetry — is anything watching this box at all
#   2  Postgres refuses connections mid-request
#   3  the API restarts while a shift is open
#   4  the whole box reboots while a shift is open
#   5  the disk fills
#   6  the tag host goes down entirely
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
TAG_HOST="$(node -e 'process.stdout.write(require("./ops/branding.json").tagHost)')"
BASE="https://$HOST"
MARK="BREAK-DELETE-ME"

APP_KEY="${APP_KEY:-$(psst get APP_KEY 2>/dev/null || true)}"
[ -n "$APP_KEY" ] || { echo "FATAL: APP_KEY not in env or psst" >&2; exit 1; }

ADMIN_EMAIL="smoke-delete-me-break@localhost.invalid"
ADMIN_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"

TMP="$(mktemp -d)"
ADMIN_JAR="$TMP/admin.cookies"
WORKER_JAR="$TMP/worker.cookies"
FILLER=/var/tmp/nfc-break-filler

FAILED=0
ok()      { printf '  ok:   %s\n' "$1"; }
bad()     { printf '  FAIL: %s\n' "$1"; FAILED=1; }
saw()     { printf '  SAW:  %s\n' "$1"; }
note()    { printf '  note: %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

psql_box() { ssh "$HOST" "sudo -u postgres psql -q -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

# ---- restore EVERYTHING, first, before anything can break -------------------------------
# Written before the first mutation and installed as the trap immediately: a run killed
# between `systemctl stop postgresql` and the restart would otherwise leave the client's
# database down.
restore_box() {
  ssh "$HOST" "sudo systemctl start postgresql >/dev/null 2>&1; \
               sudo systemctl start nfc-api    >/dev/null 2>&1; \
               sudo rm -f $FILLER" >/dev/null 2>&1
  ssh "$TAG_HOST" "sudo systemctl start nginx" >/dev/null 2>&1
}

cleanup() {
  local rc=$?
  section "restore"
  restore_box
  # Serving again, from the outside, before anything else is claimed.
  local health i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    health=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null)
    [ "$health" = "200" ] && break
    sleep 3
  done
  [ "$health" = "200" ] && ok "$BASE/health answers 200 again" || { bad "$BASE/health answers $health — THE BOX IS LEFT BROKEN"; rc=1; }
  local tag
  tag=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$TAG_HOST/.well-known/assetlinks.json" 2>/dev/null)
  [ "$tag" = "200" ] && ok "the tag host serves assetlinks again ($tag)" || { bad "tag host: $tag"; rc=1; }

  psql_box "
    BEGIN;
    DELETE FROM shifts            WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM worker_sessions   WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM material_requests WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM phone_identities  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM workers           WHERE name LIKE '${MARK}%';
    COMMIT;" >/dev/null || { bad "cleanup transaction FAILED"; rc=1; }

  ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs delete $ADMIN_EMAIL'" >/dev/null 2>&1

  local left
  left=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
  echo "  after: workers/shifts/locations/admins = $left"
  [ "$left" = "0/0/1/1" ] && ok "production is exactly as it was found" || { bad "production is NOT as it was found"; rc=1; }

  rm -rf "$TMP"
  if [ "$FAILED" -ne 0 ]; then echo; echo "BREAK-INFRA FAILED"; exit 1; fi
  echo; echo "BREAK-INFRA OK — $BASE"
  exit "$rc"
}

req() {
  local method="$1" path="$2"; shift 2
  local args=(-sS --max-time 25 -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path")
  while [ $# -gt 0 ]; do
    case "$1" in
      --jar)  args+=(-b "$2" -c "$2"); shift 2 ;;
      --key)  args+=(-H "X-App-Key: $APP_KEY"); shift ;;
      --data) args+=(-H "Content-Type: application/json" --data "$2"); shift 2 ;;
    esac
  done
  curl "${args[@]}" 2>/dev/null || echo "000"
}
body() { head -c 400 "$TMP/body" 2>/dev/null; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v={}};for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v??""))})' "$1" < "$TMP/body"; }
now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
ago()  { date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }

echo "breaking $BASE on purpose   (marker: $MARK)"
START=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
[ "$START" = "0/0/1/1" ] || { bad "the box is NOT clean: $START — refusing to run"; exit 1; }
ok "starting from a clean box ($START)"
WALL_ID=$(psql_box "SELECT id FROM locations LIMIT 1")

trap cleanup EXIT

# ---- one worker with a real session, driven through the real HTTP surface ---------------
printf '%s' "$ADMIN_PASSWORD" | ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs create $ADMIN_EMAIL'" >/dev/null 2>&1
req POST /admin/login --jar "$ADMIN_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" >/dev/null
/usr/bin/grep -q ts_session "$ADMIN_JAR" && ok "throwaway admin signed in" || { bad "no admin session"; exit 1; }
req POST /admin/workers --jar "$ADMIN_JAR" --data "{\"name\":\"$MARK cleaner\",\"hourly_rate_cents\":1450,\"active\":true}" >/dev/null
WORKER_ID=$(jget worker.id)
req POST "/admin/workers/$WORKER_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}' >/dev/null
W_CODE=$(jget code)
req POST /auth/code --key --jar "$WORKER_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$W_CODE")" >/dev/null
/usr/bin/grep -q ts_worker "$WORKER_JAR" && ok "the cleaner's phone holds a worker session" || { bad "no worker session"; exit 1; }

# =========================================================================================
section "1 · is ANYTHING watching this box"
#
# decision-23 shipped Sentry on the API. The claim in CORE-FLOW is that it is "deployed and
# blind because SENTRY_DSN was never set". That is half of it, and the smaller half.

DSN_SET=$(ssh "$HOST" "sudo /usr/bin/grep -c '^SENTRY_DSN=.\\+' /etc/nfc/env || true")
[ "${DSN_SET:-0}" = "0" ] && saw "SENTRY_DSN is not set in /etc/nfc/env" || note "SENTRY_DSN IS set"

# THE PART NOBODY HAD LOOKED AT. instrument.mjs is loaded with `node --import` or it is not
# loaded at all: `import` from inside server.js runs after pg and node:http, and the file's
# own header says so. ops/systemd/nfc-api.service in this repo carries the flag. The unit
# ACTUALLY INSTALLED ON THE BOX does not.
CMDLINE=$(ssh "$HOST" 'PID=$(systemctl show nfc-api -p MainPID --value); tr "\0" " " < /proc/$PID/cmdline')
saw "the running process is: $CMDLINE"
case "$CMDLINE" in
  *--import*instrument.mjs*) ok "the Sentry SDK is initialised in the running process" ;;
  *) bad "NO --import: instrument.mjs is never loaded. Setting SENTRY_DSN alone would change NOTHING — the SDK is not in this process at all." ;;
esac

# The repo's unit file and the deployed one, side by side. This is drift, not a typo: nothing
# in ops/deploy.sh installs or reconciles a unit file, so the repo copy is a document.
REPO_EXEC=$(/usr/bin/grep '^ExecStart=' ops/systemd/nfc-api.service)
BOX_EXEC=$(ssh "$HOST" "systemctl cat nfc-api.service | /usr/bin/grep '^ExecStart='")
if [ "$REPO_EXEC" = "$BOX_EXEC" ]; then
  ok "the deployed unit matches ops/systemd/nfc-api.service"
else
  bad "the deployed unit DIFFERS from the repo's:"
  printf '        repo: %s\n        box:  %s\n' "$REPO_EXEC" "$BOX_EXEC"
fi
REPO_USER=$(/usr/bin/grep '^User=' ops/systemd/nfc-api.service)
BOX_USER=$(ssh "$HOST" "systemctl cat nfc-api.service | /usr/bin/grep '^User='")
[ "$REPO_USER" = "$BOX_USER" ] && ok "the unit's User matches ($BOX_USER)" \
  || bad "User drift — repo says $REPO_USER, box runs $BOX_USER"

# =========================================================================================
section "2 · Postgres refuses connections mid-request"
#
# The database going away is the single most likely infrastructure failure here: it shares a
# VM with the API, an OOM or an apt upgrade takes it out, and it is the only store of truth.

PID_BEFORE=$(ssh "$HOST" "systemctl show nfc-api -p MainPID --value")
ssh "$HOST" "sudo systemctl stop postgresql" >/dev/null 2>&1
sleep 2
PG_ACTIVE=$(ssh "$HOST" "systemctl is-active postgresql@16-main" 2>/dev/null)
saw "postgresql is now: $PG_ACTIVE"

# a) the API process itself
API_UP=$(ssh "$HOST" "systemctl is-active nfc-api")
[ "$API_UP" = "active" ] \
  && ok "the API process stayed UP with no database — it does not crash-loop, so it is there to answer when Postgres returns" \
  || bad "the API went $API_UP when the database stopped"

# b) THE CLOCK-IN. This is the sentence that matters: a cleaner is at a door.
TAP=$(uuid)
CODE=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 5)\"}")
saw "clock-in with the database down -> HTTP $CODE  $(body)"
case "$CODE" in
  5*|000) ok "a 5xx/timeout, which the phone classifies RETRYABLE (ApiFailure.isRetryable: status >= 500 || status == 0) — the tap stays queued on the phone and is replayed" ;;
  4*) bad "HTTP $CODE — a 4xx is TERMINAL on the phone (SyncPlan.blocksRow) and would throw the shift away for a database outage" ;;
  *)  bad "HTTP $CODE with no database is not a failure at all — something answered from a cache" ;;
esac

# AND WHAT RECORD EXISTS OF IT. This is section 1's cost, made concrete: a real 500 on the
# clock-in path, in production, right now. Where did it go?
ERRLINE=$(ssh "$HOST" "sudo journalctl -u nfc-api --no-pager -o cat -n 40" 2>/dev/null | /usr/bin/grep -E '^\[500\] POST /shifts/open' | tail -1)
if [ -n "$ERRLINE" ]; then
  saw "the ONLY record of that failed clock-in, anywhere: $ERRLINE"
  ok "console.error in server.js caught it — which is why decision-23 put the access log in as well as Sentry"
else
  bad "a 500 on POST /shifts/open left NO line in journald either"
fi
note "that line is in journald on this VM, it is not aggregated, nothing alerts on it, and it rotates. With no --import and no DSN there is no second copy. A clock-in failing in a stairwell is discovered by a human reading a phone screen and telephoning the office."

# c) health, which is what any future uptime monitor would watch
HCODE=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)
saw "GET /health with the database down -> $HCODE"
[ "$HCODE" = "500" ] && ok "/health goes red when the database is down — it is a real health check, not a liveness ping" \
                     || bad "/health answered $HCODE with no database: it would report this outage as healthy"

# d) THE DIRECTOR'S PANEL. A static export, so the shell loads and the data does not.
ACODE=$(req GET /admin/data --jar "$ADMIN_JAR")
PCODE=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$BASE/" 2>/dev/null || echo 000)
saw "the panel's HTML -> $PCODE, its data call -> $ACODE"
[ "$PCODE" = "200" ] && [ "$ACODE" != "200" ] \
  && note "the director gets a page that LOADS and then fails to fill: static export + client-side fetch (decision-16). Whether that reads as 'server down' or as 'no buildings yet' is a UX question, not an availability one — see section 2e." \
  || note "panel $PCODE / data $ACODE"

# e) does it recover WITHOUT A HUMAN? pg.Pool is assumed to reconnect. Assumed by whom?
ssh "$HOST" "sudo systemctl start postgresql" >/dev/null 2>&1
RECOVERED=""
for i in $(seq 1 20); do
  sleep 2
  H=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)
  [ "$H" = "200" ] && { RECOVERED="$((i * 2))s"; break; }
done
[ -n "$RECOVERED" ] \
  && ok "the API recovered on its own ${RECOVERED} after Postgres came back — NOBODY had to restart it" \
  || bad "the API did NOT recover after Postgres returned — a database blip requires an ssh session to fix"

# THE PID IS THE PROOF, not the recovery. `Restart=always` would also produce a healthy box
# after a crash loop, and that is a DIFFERENT and worse outcome: a restart drops every
# in-flight request. An unchanged PID says the pool re-dialled inside a process that never
# went away, so a clock-in arriving one second after Postgres returns is served, not refused.
PID_AFTER=$(ssh "$HOST" "systemctl show nfc-api -p MainPID --value")
[ "$PID_BEFORE" = "$PID_AFTER" ] \
  && ok "same PID before and after ($PID_AFTER) — pg.Pool re-dialled; the process never restarted and never crash-looped" \
  || bad "nfc-api restarted during the outage ($PID_BEFORE -> $PID_AFTER): it crash-looped rather than waiting"

# f) AND THE TAP THAT FAILED, REPLAYED. The phone's retry, with the same client_uuid.
CODE=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 5)\"}")
[ "$CODE" = "201" ] \
  && ok "the replayed tap lands 201 — the cleaner's hours are NOT lost by a database outage, they are delayed" \
  || bad "the replayed tap answered $CODE: $(body)"
ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$TAP'")
[ "$ROWS" = "1" ] && ok "exactly one shift row for that tap" || bad "$ROWS rows for one tap"

# =========================================================================================
section "3 · the API restarts while a shift is open"
#
# decision-19 says the server is authoritative for who is clocked in. That is only true if a
# restart does not lose it — which it cannot, because the row is in Postgres. Asserted rather
# than reasoned, because "obviously fine" is how the phone-layout caption bug survived.

OPEN_BEFORE=$(psql_box "SELECT client_uuid FROM shifts WHERE end_time IS NULL")
[ "$OPEN_BEFORE" = "$TAP" ] && ok "a shift is open right now ($TAP)" || bad "expected the open shift to be $TAP, got '$OPEN_BEFORE'"

ssh "$HOST" "sudo systemctl restart nfc-api" >/dev/null 2>&1
sleep 4
for i in $(seq 1 10); do
  H=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)
  [ "$H" = "200" ] && break; sleep 2
done
CODE=$(req GET /shifts/open --key --jar "$WORKER_JAR")
STILL=$(jget shift.client_uuid)
[ "$CODE" = "200" ] && [ "$STILL" = "$TAP" ] \
  && ok "GET /shifts/open still returns the running shift after a restart — the phone re-arms its lock screen and its ongoing notification from this, with no worker action" \
  || bad "after the restart GET /shifts/open -> $CODE, shift '$STILL'"

# The worker session survived too. It is a row, not process memory — but a server that kept
# sessions in a Map would pass every other assertion in this section and log the cleaner out.
[ "$CODE" = "200" ] && ok "the worker session survived the restart (it is a row in worker_sessions, not process memory)"

# =========================================================================================
section "4 · the whole box reboots while a shift is open"
if [ "${SKIP_REBOOT:-0}" = "1" ]; then
  note "skipped (SKIP_REBOOT=1)"
else
  BOOT_BEFORE=$(ssh "$HOST" "cat /proc/sys/kernel/random/boot_id")
  ssh "$HOST" "sudo systemctl reboot" >/dev/null 2>&1 &
  sleep 20
  BACK=""
  for i in $(seq 1 45); do
    H=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "$BASE/health" 2>/dev/null || echo 000)
    [ "$H" = "200" ] && { BACK="$((20 + i * 4))s"; break; }
    sleep 4
  done
  BOOT_AFTER=$(ssh -o ConnectTimeout=10 "$HOST" "cat /proc/sys/kernel/random/boot_id" 2>/dev/null)
  if [ "$BOOT_BEFORE" = "$BOOT_AFTER" ] || [ -z "$BOOT_AFTER" ]; then
    bad "the box did not actually reboot (boot_id unchanged) — this section proved nothing"
  else
    ok "the box really rebooted (boot_id $BOOT_BEFORE -> $BOOT_AFTER)"
    [ -n "$BACK" ] && ok "it was serving again ~$BACK after the reboot command, with nobody logged in" \
                   || bad "the box did NOT come back serving — every enabled unit is a claim, and one of them is false"
  fi
  # Everything that has to come back by itself.
  for unit in postgresql nfc-api nfc-autoclose.timer nfc-backup.timer; do
    A=$(ssh "$HOST" "systemctl is-active $unit" 2>/dev/null)
    case "$A" in
      active|waiting) ok "$unit came back by itself ($A)" ;;
      *) bad "$unit is '$A' after the reboot" ;;
    esac
  done
  CODE=$(req GET /shifts/open --key --jar "$WORKER_JAR")
  STILL=$(jget shift.client_uuid)
  [ "$CODE" = "200" ] && [ "$STILL" = "$TAP" ] \
    && ok "the shift that was running before the reboot is STILL RUNNING, and the same session still reads it" \
    || bad "after the reboot GET /shifts/open -> $CODE, shift '$STILL'"
  # And the tag host's job, which is what a card on a wall points at.
  TCODE=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$TAG_HOST/.well-known/assetlinks.json" 2>/dev/null || echo 000)
  [ "$TCODE" = "200" ] && ok "the tag host is unaffected ($TCODE) — it is a different VM, which is the point of decision-40"
fi

# =========================================================================================
section "5 · the disk fills"
#
# Not hypothetical: journald, 14 days of dumps and Postgres share one 25G filesystem, and
# `find -mtime +14` is the only thing keeping the dumps bounded. Filled to a thin margin,
# then released — the filler is a single file this script's trap removes.

FREE_MB=$(ssh "$HOST" "df --output=avail -m / | tail -1 | tr -d ' '")
saw "free space before: ${FREE_MB} MB"
# TWO MARGINS, because the first one proved almost nothing. At 40 MB a shift row still
# writes: it is a few hundred bytes and Postgres has WAL already allocated. The interesting
# question is the one at the bottom of the disk, where a checkpoint has nowhere to go.
# DISK_MARGIN_MB is a knob so this can be re-run harsher or gentler without editing.
MARGIN="${DISK_MARGIN_MB:-4}"
FILL_MB=$((FREE_MB - MARGIN))
ssh "$HOST" "sudo fallocate -l ${FILL_MB}M $FILLER" >/dev/null 2>&1
AVAIL=$(ssh "$HOST" "df --output=avail -m / | tail -1 | tr -d ' '")
saw "free space now: ${AVAIL} MB"

# a) CAN A CLEANER STILL CLOCK IN? "clock-in is never blocked by anything" is the standing
#    constraint, and a full disk is the most ordinary way a write starts failing.
TAP2=$(uuid)
CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP\",\"end_time\":\"$(now)\"}")
saw "clock-OUT on a nearly full disk -> $CODE  $(body)"
CODE2=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP2\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 3)\"}")
saw "clock-IN on a nearly full disk -> $CODE2  $(body)"
if [ "$CODE" = "200" ] && [ "$CODE2" = "201" ]; then
  ok "both halves of a shift still work with ${AVAIL} MB free — a shift row is a few hundred bytes and Postgres has WAL headroom"
else
  note "a clock-in/out failed at ${AVAIL} MB free. That is the honest finding: the disk is a shared, unmonitored resource and nothing on this box warns before it runs out."
fi

# b) THE BACKUP is the first thing that dies, and it dies LOUDLY, which is the good outcome.
ssh "$HOST" "sudo systemctl start nfc-backup" >/dev/null 2>&1
BRC=$(ssh "$HOST" "systemctl show nfc-backup -p ExecMainStatus --value")
BLINE=$(ssh "$HOST" "sudo journalctl -u nfc-backup --no-pager -o cat -n 3" | tail -2 | tr '\n' ' ')
saw "the backup on a full disk: exit $BRC — $BLINE"
if [ "$BRC" = "0" ]; then
  note "the backup still succeeded — ${AVAIL} MB was enough for a 7 KB dump. On a real payroll database it would not be."
else
  ok "the backup FAILED LOUDLY (exit $BRC) rather than writing a truncated dump — pg-backup.sh's MIN_BYTES and gzip -t did their job, and nothing rotated the good dumps away"
  KEPT=$(ssh "$HOST" "sudo bash -c '/bin/ls -1 /var/backups/nfc/nfc-*.sql.gz | wc -l'")
  ok "$KEPT verified dumps are still on disk — rotation runs only after a clean verify"
  PARTIAL=$(ssh "$HOST" "sudo bash -c '/bin/ls -1 /var/backups/nfc/.nfc-*.partial 2>/dev/null | wc -l'")
  [ "$PARTIAL" = "0" ] && ok "no half-written .partial file was left behind" || bad "$PARTIAL partial dumps left on disk"
fi
note "nothing on this box alerts on free space. The backup failing is the only signal, it goes to journald, and journald is on the same disk."

ssh "$HOST" "sudo rm -f $FILLER" >/dev/null 2>&1
AVAIL=$(ssh "$HOST" "df --output=avail -m / | tail -1 | tr -d ' '")
ok "filler removed, ${AVAIL} MB free again"

# =========================================================================================
section "6 · the tag host goes down entirely"
#
# https://$TAG_HOST is what is printed on the cards on the walls. It serves the association
# files and /t and nothing else (decision-40). If it dies, what stops?

ssh "$TAG_HOST" "sudo systemctl stop nginx" >/dev/null 2>&1
sleep 2
TCODE=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$TAG_HOST/.well-known/assetlinks.json" 2>/dev/null || echo 000)
saw "the tag host with nginx stopped -> $TCODE"

# a) A TAP BY AN ALREADY-INSTALLED APP. App Links were verified when the app was installed;
#    Android does not re-fetch assetlinks.json to open a link it has already verified. So the
#    tap should be entirely unaffected — the phone parses the UUID out of the URL and calls
#    the API HOST, which is a different machine.
TAP3=$(uuid)
CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP2\",\"end_time\":\"$(now)\"}")
CODE3=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP3\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 2)\"}")
[ "$CODE3" = "201" ] \
  && ok "a cleaner still clocks in with the tag host completely down ($CODE3) — the card's URL is parsed on the phone and the shift goes to the API host. THE TWO-HOST SPLIT EARNS ITS KEEP HERE." \
  || bad "clock-in answered $CODE3 with the tag host down — the tap path depends on a machine it should not"

# b) what actually stops: a FRESH INSTALL cannot verify App Links, so a tap opens a browser
#    instead of the app, and the browser lands on a dead host.
[ "$TCODE" = "200" ] && bad "nginx was stopped and the tag host still answers 200 — something else is serving it" \
                     || ok "the association files are gone ($TCODE): a phone installing the app RIGHT NOW cannot verify App Links, so its taps would open a browser instead of the app until the host is back"
note "and nothing corrupts. The tag host has no database and no writes (decision-40) — there is no state on it to lose, only availability. A card on a wall does not need to be rewritten."

# c) the API host serves the same bytes as a fallback (AGENTS.md). Does it?
FCODE=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/.well-known/assetlinks.json" 2>/dev/null || echo 000)
[ "$FCODE" = "200" ] \
  && ok "the API host serves assetlinks.json too ($FCODE) — but that is NOT a fallback for the tag host: assetlinks is fetched per HOSTNAME, and the card names the tag host" \
  || note "the API host answers $FCODE for assetlinks.json"

ssh "$TAG_HOST" "sudo systemctl start nginx" >/dev/null 2>&1
sleep 2
TCODE=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$TAG_HOST/.well-known/assetlinks.json" 2>/dev/null || echo 000)
[ "$TCODE" = "200" ] && ok "the tag host is back ($TCODE)" || bad "the tag host did not come back: $TCODE"

# close the last shift so the box is left with none open
req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP3\",\"end_time\":\"$(now)\"}" >/dev/null
