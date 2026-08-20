#!/usr/bin/env bash
#
# THE THINGS THAT HAPPEN AT A DOOR, DONE ON PURPOSE, AGAINST PRODUCTION.
#
#     ./ops/break-taps.sh [host]
#
# Not "does the route answer 201". A cleaner at a stairwell door with a phone in one hand:
#
#   two taps in one second            the card is held near, moved, held again
#   the same tap replayed             the phone retried after a dropped connection
#   a tap while a shift is open       they forgot to tap out yesterday
#   a tap at a DIFFERENT building     they went straight from one job to the next
#   a clock-out with no clock-in      the queue pushed a close whose open never landed
#   two concurrent closes             the phone and the 8h timer at the same instant
#   the 8h timer fires mid-tap        the worst case, and the one nobody has run
#   a session that expires mid-shift  and what it costs the row still on the phone
#   an enrolment code redeemed twice  two phones, one code, at the same moment
#
# Concurrency is REAL concurrency: curl processes started together and reaped together, not
# two sequential calls with a comment claiming they raced. A sequential pair proves the
# handler is idempotent; only a genuine race proves the INDEX is.
#
# Everything is marked, deleted, and counted afterwards.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
BASE="https://$HOST"
MARK="BREAK-DELETE-ME"

APP_KEY="${APP_KEY:-$(psst get APP_KEY 2>/dev/null || true)}"
[ -n "$APP_KEY" ] || { echo "FATAL: APP_KEY not in env or psst" >&2; exit 1; }

ADMIN_EMAIL="smoke-delete-me-taps@localhost.invalid"
ADMIN_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"

TMP="$(mktemp -d)"
ADMIN_JAR="$TMP/admin.cookies"
WORKER_JAR="$TMP/worker.cookies"

FAILED=0
ok()      { printf '  ok:   %s\n' "$1"; }
bad()     { printf '  FAIL: %s\n' "$1"; FAILED=1; }
saw()     { printf '  SAW:  %s\n' "$1"; }
note()    { printf '  note: %s\n' "$1"; }
section() { printf '\n== %s\n' "$1"; }

psql_box() { ssh "$HOST" "sudo -u postgres psql -q -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

cleanup() {
  local rc=$?
  section "cleanup"
  psql_box "
    BEGIN;
    DELETE FROM shifts            WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM worker_sessions   WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM material_requests WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM phone_identities  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM shifts            WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'break-delete-me-%');
    DELETE FROM zones             WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'break-delete-me-%');
    DELETE FROM locations         WHERE slug LIKE 'break-delete-me-%';
    DELETE FROM workers           WHERE name LIKE '${MARK}%';
    COMMIT;" >/dev/null || { bad "cleanup transaction FAILED — rows may survive"; rc=1; }
  ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs delete $ADMIN_EMAIL'" >/dev/null 2>&1
  local left
  left=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
  echo "  after: workers/shifts/locations/admins = $left"
  [ "$left" = "0/0/1/1" ] && ok "production is exactly as it was found" || { bad "production is NOT as it was found"; rc=1; }
  rm -rf "$TMP"
  if [ "$FAILED" -ne 0 ]; then echo; echo "BREAK-TAPS FAILED"; exit 1; fi
  echo; echo "BREAK-TAPS OK — $BASE"
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
# A request whose status AND body go to numbered files, for the concurrent pairs below.
bg() {
  local slot="$1" method="$2" path="$3" data="${4:-}"
  local args=(-sS --max-time 25 -o "$TMP/b$slot" -w '%{http_code}' -X "$method" "$BASE$path"
              -H "X-App-Key: $APP_KEY" -b "$WORKER_JAR")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" --data "$data")
  curl "${args[@]}" > "$TMP/s$slot" 2>/dev/null || echo 000 > "$TMP/s$slot"
}
body() { head -c 300 "$TMP/body" 2>/dev/null; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v={}};for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v??""))})' "$1" < "$TMP/body"; }
jgetf() { node -e 'let s=require("node:fs").readFileSync(process.argv[2],"utf8");let v;try{v=JSON.parse(s)}catch{v={}};for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v??""))' "$1" "$2"; }
now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
ago()  { date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }

echo "tapping $BASE badly on purpose   (marker: $MARK)"
START=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
[ "$START" = "0/0/1/1" ] || { bad "the box is NOT clean: $START — refusing to run"; exit 1; }
ok "starting from a clean box ($START)"
WALL_ID=$(psql_box "SELECT id FROM locations LIMIT 1")

trap cleanup EXIT

printf '%s' "$ADMIN_PASSWORD" | ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs create $ADMIN_EMAIL'" >/dev/null 2>&1
req POST /admin/login --jar "$ADMIN_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")" >/dev/null
/usr/bin/grep -q ts_session "$ADMIN_JAR" || { bad "no admin session"; exit 1; }
req POST /admin/workers --jar "$ADMIN_JAR" --data "{\"name\":\"$MARK cleaner\",\"hourly_rate_cents\":1450,\"active\":true}" >/dev/null
WORKER_ID=$(jget worker.id)
req POST "/admin/workers/$WORKER_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}' >/dev/null
W_CODE=$(jget code)
req POST /auth/code --key --jar "$WORKER_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$W_CODE")" >/dev/null
/usr/bin/grep -q ts_worker "$WORKER_JAR" && ok "one cleaner, signed in" || { bad "no worker session"; exit 1; }

# A SECOND BUILDING, so "a tap at a different building" is a real different building and not
# a re-tap of the same one wearing a different variable name.
# NO `id` IN THE BODY. On POST /admin/locations a supplied `id` means UPDATE THAT ROW, and an
# id that does not exist is 404 unknown_location — it is not "create with this uuid". (That
# path is /admin/tags/:id/resolve-building, where the id comes off a card.)
req POST "/admin/locations" --jar "$ADMIN_JAR" \
  --data "{\"name\":\"$MARK zweites Haus\",\"slug\":\"break-delete-me-zwei\",\"active\":true}" >/dev/null
SECOND_ID=$(jget location.id)
case "$SECOND_ID" in
  *-*-*-*-*) ok "a second building exists ($SECOND_ID)" ;;
  *) note "could not create a second building ($(body)); the different-building case will be skipped"; SECOND_ID="" ;;
esac

# =========================================================================================
section "1 · two taps in one second"
#
# One physical tap can be DELIVERED twice on Android (the NDEF dispatch and the App Link),
# which is why core/TapInbox.kt collapses identical taps inside 3s. That is the phone's net.
# This is the server's: what if both get through?

# a) SAME client_uuid, genuinely concurrent. This is the double delivery, or a retry that
#    overlapped the original. Exactly one row is the only acceptable answer.
TAP=$(uuid); T=$(ago 30)
D="{\"client_uuid\":\"$TAP\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$T\"}"
bg 1 POST /shifts/open "$D" & P1=$!
bg 2 POST /shifts/open "$D" & P2=$!
wait $P1 $P2
S1=$(cat "$TMP/s1"); S2=$(cat "$TMP/s2")
saw "two simultaneous identical taps -> $S1 and $S2"
ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$TAP'")
[ "$ROWS" = "1" ] && ok "exactly ONE shift row — the cleaner is not paid twice and the client is not billed twice" \
                  || bad "$ROWS rows from one tap delivered twice"
case "$S1$S2" in
  *201*) ok "one of them created it ($S1/$S2); the other saw the stored row" ;;
  *) bad "neither answered 201: $S1/$S2" ;;
esac
[ "$S1" = "500" ] || [ "$S2" = "500" ] \
  && bad "a race produced a 500 — a unique violation reached the client as a server fault" \
  || ok "no 500: the ON CONFLICT DO NOTHING + re-read path absorbed the race"

# b) DIFFERENT client_uuid, same worker, concurrent. Two phones, or a phone that lost its
#    idempotency key. The partial unique index is the only thing standing here.
A=$(uuid); B=$(uuid); T=$(ago 20)
bg 3 POST /shifts/open "{\"client_uuid\":\"$A\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$T\"}" & P1=$!
bg 4 POST /shifts/open "{\"client_uuid\":\"$B\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$T\"}" & P2=$!
wait $P1 $P2
S3=$(cat "$TMP/s3"); S4=$(cat "$TMP/s4")
saw "two simultaneous taps with DIFFERENT keys -> $S3 and $S4"
OPEN_ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE end_time IS NULL AND worker_id = $WORKER_ID")
# The first tap of section 1a is still open, so 1 is right: the pair added at most one more.
[ "$OPEN_ROWS" = "1" ] \
  && ok "still exactly ONE open shift for this worker — shifts_one_open_per_worker_idx held under a genuine race" \
  || bad "$OPEN_ROWS open shifts for one worker: the partial unique index did not hold"
case "$S3-$S4" in
  409-409) ok "both refused 409 (the section-1a shift is still open) — neither silently became a second clock-in" ;;
  *) saw "statuses $S3/$S4" ;;
esac
[ "$S3" = "500" ] || [ "$S4" = "500" ] && bad "the index violation surfaced as a 500" || ok "no 500 from the index race"

# =========================================================================================
section "2 · the same tap replayed, minutes later"
CODE=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "$D")
DUP=$(jget duplicate)
[ "$CODE" = "200" ] && [ "$DUP" = "true" ] \
  && ok "a replay answers 200 duplicate:true and returns the STORED row — the phone converges on the server's copy" \
  || bad "replay -> $CODE duplicate=$DUP"
ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$TAP'")
[ "$ROWS" = "1" ] && ok "still one row" || bad "$ROWS rows after the replay"

# THE REPLAY WITH A DIFFERENT START TIME. A phone whose clock moved, or a queued row edited.
# First write wins; the stored start_time must not be rewritten by a later retry.
STORED_BEFORE=$(psql_box "SELECT start_time FROM shifts WHERE client_uuid = '$TAP'")
req POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 300)\"}" >/dev/null
STORED_AFTER=$(psql_box "SELECT start_time FROM shifts WHERE client_uuid = '$TAP'")
[ "$STORED_BEFORE" = "$STORED_AFTER" ] \
  && ok "a replay claiming a start_time five hours earlier did NOT move the stored one — first write wins, so a retry cannot inflate a payslip" \
  || bad "the stored start_time changed on replay: $STORED_BEFORE -> $STORED_AFTER"

# =========================================================================================
section "3 · a tap while a shift is already open"
NEW=$(uuid)
CODE=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$NEW\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(now)\"}")
ERR=$(jget error); OPEN_UUID=$(jget shift.client_uuid)
[ "$CODE" = "409" ] && [ "$ERR" = "shift_already_open" ] \
  && ok "409 shift_already_open, WITH the offending shift in the body ($OPEN_UUID) — the app can say which one and offer to close it" \
  || bad "-> $CODE $ERR"
note "409 shift_already_open is the ONE 4xx ApiFailure.isRetryable treats as retryable, because SyncPlan works oldest-first: the next pass closes the older shift and this open then lands. Verified in android/checks, asserted here against the live server's actual code."

# =========================================================================================
section "4 · a tap at a DIFFERENT building while one is open"
if [ -n "$SECOND_ID" ]; then
  OTHER=$(uuid)
  CODE=$(req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$OTHER\",\"location_uuid\":\"$SECOND_ID\",\"start_time\":\"$(now)\"}")
  ERR=$(jget error)
  saw "tap at the second building with a shift open at the first -> $CODE $ERR"
  [ "$CODE" = "409" ] \
    && ok "refused 409, not silently opened. The APP is what turns this into 'close there, open here' (auto_closed=true, so the walk between sites goes to the resolution screen and never straight to payroll)" \
    || bad "-> $CODE: a second building opened a shift while one was already running"
  ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$OTHER'")
  [ "$ROWS" = "0" ] && ok "no row was written for the refused tap" || bad "$ROWS rows written for a refused tap"

  # And the close that names the wrong building: recording it would put one building's door
  # time onto another building's shift.
  CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP\",\"location_uuid\":\"$SECOND_ID\",\"end_time\":\"$(now)\"}")
  ERR=$(jget error)
  [ "$CODE" = "422" ] && [ "$ERR" = "wrong_building" ] \
    && ok "a close naming a DIFFERENT building is 422 wrong_building — an end time from one door never lands on another building's shift" \
    || bad "close at the wrong building -> $CODE $ERR"
  STILL=$(psql_box "SELECT coalesce(end_time::text,'OPEN') FROM shifts WHERE client_uuid = '$TAP'")
  [ "$STILL" = "OPEN" ] && ok "and the shift is still open — the refusal did not half-close it" || bad "the shift moved to $STILL"
else
  note "skipped: no second building"
fi

# =========================================================================================
section "5 · a clock-out with no clock-in"
GHOST=$(uuid)
CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$GHOST\",\"end_time\":\"$(now)\"}")
ERR=$(jget error)
[ "$CODE" = "404" ] && [ "$ERR" = "unknown_shift" ] \
  && ok "404 unknown_shift — no row is invented from a close alone" \
  || bad "-> $CODE $ERR"
ROWS=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$GHOST'")
[ "$ROWS" = "0" ] && ok "and nothing was written" || bad "$ROWS rows"
note "404 is NOT retryable on the phone, so this blocks the row — which is right: SyncPlan already refuses to attempt a Close whose Open failed in the same pass, so reaching here means the open will never land."

# =========================================================================================
section "6 · two concurrent clock-outs"
bg 5 POST /shifts/close "{\"client_uuid\":\"$TAP\",\"end_time\":\"$(now)\"}" & P1=$!
bg 6 POST /shifts/close "{\"client_uuid\":\"$TAP\",\"end_time\":\"$(now)\"}" & P2=$!
wait $P1 $P2
S5=$(cat "$TMP/s5"); S6=$(cat "$TMP/s6")
saw "two simultaneous clock-outs -> $S5 and $S6"
[ "$S5" = "200" ] && [ "$S6" = "200" ] \
  && ok "both 200 — the loser re-reads the winner's row rather than erroring. The shift IS closed, which is what both callers asked for." \
  || bad "-> $S5/$S6"
ENDS=$(psql_box "SELECT count(DISTINCT end_time) FROM shifts WHERE client_uuid = '$TAP'")
[ "$ENDS" = "1" ] && ok "one end_time, not two — no last-writer-wins rewrite of somebody's hours" || bad "$ENDS distinct end times"

# =========================================================================================
section "7 · the 8h timer fires while the worker is holding the phone to the tag"
#
# THE CASE NOBODY HAS RUN. A shift is at 8h+ and the autoclose UPDATE and the worker's own
# clock-out land at the same instant. Two writers, one row, and the loser must not be told
# something false. Seeded at 8h01m so the timer will genuinely match it.

RACE=$(uuid)
psql_box "INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
          VALUES ($WORKER_ID, '$WALL_ID', now() - INTERVAL '8 hours 1 minute', '$RACE')" >/dev/null
ok "a shift seeded at 8h01m, open — the timer will match it on its next run"

# The timer and the tap, fired together.
ssh "$HOST" "sudo systemctl start nfc-autoclose" >/dev/null 2>&1 &
TIMER_PID=$!
bg 7 POST /shifts/close "{\"client_uuid\":\"$RACE\",\"end_time\":\"$(now)\"}" & TAP_PID=$!
wait $TIMER_PID $TAP_PID 2>/dev/null
S7=$(cat "$TMP/s7")
ROW=$(psql_box "SELECT auto_closed || '|' || coalesce(corrected_at::text,'NULL') || '|' || (end_time - start_time)::text FROM shifts WHERE client_uuid = '$RACE'")
saw "the worker's clock-out during the timer -> $S7; the row is now $ROW"
[ "$S7" = "200" ] && ok "the worker's tap answered 200 either way — a cleaner at a door is never shown an error because a cron job won a race" \
                  || bad "the tap answered $S7"
CLOSED=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$RACE' AND end_time IS NOT NULL")
[ "$CLOSED" = "1" ] && ok "the shift is closed exactly once" || bad "closed count $CLOSED"

case "$ROW" in
  true*) ok "the TIMER won: auto_closed=true, corrected_at=NULL, end=start+8h. The worker's own close does NOT clear the flag (auto_closed = auto_closed OR \$3), so the shift still lands in the resolution queue instead of going to payroll with a time nobody confirmed." ;;
  false*) ok "the WORKER won: a clean, human-confirmed close, and the timer's UPDATE matched zero rows because end_time was no longer NULL. Either winner is safe." ;;
  *) bad "unexpected row state: $ROW" ;;
esac
note "the losing writer is safe BY CONSTRUCTION and not by timing: autoclose.sql's WHERE requires end_time IS NULL and its SET makes it non-NULL, so a row can match at most once ever; and closeShift's UPDATE carries the same 'AND end_time IS NULL' and falls back to re-reading the winner."

# WHICH ARM OF THAT RACE FIRES IS NOT OURS TO CHOOSE, so the other arm is run DETERMINISTICALLY
# rather than left to a re-run and a hope. Timer first, worker second — the ordering that
# actually happens in the field, because the worker is walking to the door while the timer runs.
LATE=$(uuid)
psql_box "INSERT INTO shifts (worker_id, location_id, start_time, client_uuid)
          VALUES ($WORKER_ID, '$WALL_ID', now() - INTERVAL '9 hours', '$LATE')" >/dev/null
ssh "$HOST" "sudo systemctl start nfc-autoclose" >/dev/null 2>&1
PRE=$(psql_box "SELECT auto_closed || '|' || coalesce(corrected_at::text,'NULL') FROM shifts WHERE client_uuid = '$LATE'")
[ "$PRE" = "true|NULL" ] && ok "the timer closed it first ($PRE) — now the worker taps out, late" || bad "the timer left the row as $PRE"
CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$LATE\",\"end_time\":\"$(now)\"}")
# `jget` renders a JSON null as the empty string, so corrected_at is compared against "" and
# not against "null". Getting that wrong turned a correct server into a red line.
DUP=$(jget duplicate); AC=$(jget shift.auto_closed); CORR=$(jget shift.corrected_at)
[ "$CODE" = "200" ] && [ "$DUP" = "true" ] \
  && ok "the late tap-out answers 200 duplicate:true — no error at the door for a shift the server already closed" \
  || bad "the late tap-out -> $CODE duplicate=$DUP"
[ "$AC" = "true" ] && [ -z "$CORR" ] \
  && ok "and the response still carries auto_closed=true, corrected_at=null — so the app routes the worker to the RESOLUTION screen instead of pretending the tap-out counted. Closing does not silently resolve." \
  || bad "the response says auto_closed=$AC corrected_at=$CORR — a tap-out silently resolved a timer close"
END8=$(psql_box "SELECT (end_time - start_time)::text FROM shifts WHERE client_uuid = '$LATE'")
[ "$END8" = "08:00:00" ] \
  && ok "the stored end time is still start+8h ($END8): the worker's later timestamp did NOT overwrite it, so nobody is paid for the hours between the timeout and the tap" \
  || bad "the end time became $END8"

# =========================================================================================
section "8 · a worker session expires mid-shift"
#
# THE COST IS ON THE PHONE, NOT ON THE SERVER, and this is the finding of the whole run.

LIVE=$(uuid)
req POST /shifts/open --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$LIVE\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(ago 60)\"}" >/dev/null
psql_box "UPDATE worker_sessions SET expires_at = now() - INTERVAL '1 minute' WHERE worker_id = $WORKER_ID" >/dev/null
ok "the worker's session has been expired while their shift is running"

CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$LIVE\",\"end_time\":\"$(now)\"}")
ERR=$(jget error)
saw "the clock-out with an expired session -> $CODE $ERR"
[ "$CODE" = "401" ] && ok "401 $ERR — correct on the server's side: an expired credential is not a valid one" \
                    || bad "-> $CODE $ERR"

STILL=$(psql_box "SELECT coalesce(end_time::text,'OPEN') FROM shifts WHERE client_uuid = '$LIVE'")
[ "$STILL" = "OPEN" ] && ok "the shift is still OPEN on the server, so the 8h timer will still close it — the hours are not lost SERVER-side" \
                      || bad "the shift is $STILL"

bad "BUT ON THE PHONE THAT ROW IS NOW DEAD. ApiFailure.isRetryable is false for 401, so SyncPlan.blocksRow returns true, ShiftSync calls store.markFailed(..., blocked = true), and SyncPlan.plan skips every syncBlocked row for ever. Nothing anywhere clears sync_blocked except markOpenSynced/markCloseSynced, which are unreachable for a row that is never planned. Signing back in does not revive it. A shift taken offline and pushed after the session lapsed is hours the cleaner worked and the phone will never send. The only signal is a red line in a list."
note "the same classification blocks a queued MATERIAL REQUEST (MaterialQueue.outcome -> BLOCKED for any non-retryable 4xx). Filed as TASK-224."

# restore the session so section 9 can run
psql_box "UPDATE worker_sessions SET expires_at = now() + INTERVAL '1 day' WHERE worker_id = $WORKER_ID" >/dev/null
CODE=$(req POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$LIVE\",\"end_time\":\"$(now)\"}")
[ "$CODE" = "200" ] && ok "with the session restored the same call lands 200 — the PAYLOAD was always fine, which is exactly why 401 should be retryable" || bad "-> $CODE"

# =========================================================================================
section "9 · one enrolment code, two phones, at the same moment"
#
# decision-26 says a code is single-use. Single-use under a race is a different claim.
req POST "/admin/workers/$WORKER_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}' >/dev/null
RACE_CODE=$(jget code)
[ -n "$RACE_CODE" ] && ok "a fresh code issued" || { bad "no code"; }
RD="$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$RACE_CODE")"
SESSIONS_BEFORE=$(psql_box "SELECT count(*) FROM worker_sessions WHERE worker_id = $WORKER_ID")
curl -sS --max-time 25 -o "$TMP/b8" -w '%{http_code}' -X POST -H "X-App-Key: $APP_KEY" \
     -H 'Content-Type: application/json' --data "$RD" -c "$TMP/j8" "$BASE/auth/code" > "$TMP/s8" 2>/dev/null & P1=$!
curl -sS --max-time 25 -o "$TMP/b9" -w '%{http_code}' -X POST -H "X-App-Key: $APP_KEY" \
     -H 'Content-Type: application/json' --data "$RD" -c "$TMP/j9" "$BASE/auth/code" > "$TMP/s9" 2>/dev/null & P2=$!
wait $P1 $P2
S8=$(cat "$TMP/s8"); S9=$(cat "$TMP/s9")
saw "one code, two simultaneous redemptions -> $S8 and $S9"
SESSIONS=$(psql_box "SELECT count(*) FROM worker_sessions WHERE worker_id = $WORKER_ID")
# One code must mint exactly ONE new session. The worker already held one from signing in at
# the top of this run, so the number to assert is the DELTA, not the total — asserting the
# total would have to encode how many times this script signs in, which is how a check ends up
# green for the wrong reason.
[ "$SESSIONS" = "$((SESSIONS_BEFORE + 1))" ] \
  && ok "the race minted exactly ONE new session ($SESSIONS_BEFORE -> $SESSIONS)" \
  || bad "sessions went $SESSIONS_BEFORE -> $SESSIONS: one code produced $((SESSIONS - SESSIONS_BEFORE)) sessions"
case "$S8-$S9" in
  200-200) bad "BOTH redemptions succeeded — the code is not single-use under a race, and two phones now hold a session for one worker" ;;
  200-*|*-200) ok "exactly one succeeded ($S8/$S9); the loser was refused" ;;
  *) bad "neither succeeded: $S8/$S9" ;;
esac
# There is no enrolment_codes TABLE — decision-26 keeps one hashed code per worker as columns
# on `workers`, which is itself what makes single-use a single UPDATE and not a two-row dance.
REDEEMED=$(psql_box "SELECT coalesce(enrolment_code_redeemed_at::text,'NOT REDEEMED') || ' | hash ' || CASE WHEN enrolment_code_hash IS NULL THEN 'cleared' ELSE 'present' END FROM workers WHERE id = $WORKER_ID")
saw "the code row after the race: $REDEEMED"
saw "$SESSIONS live session(s) for this worker"
LOSER=$( [ "$S8" = "200" ] && cat "$TMP/b9" || cat "$TMP/b8" )
case "$LOSER" in
  *invalid_code*) ok "the loser gets the byte-identical invalid_code body decision-26 requires — 'already redeemed' is not distinguishable from 'never existed'" ;;
  *) saw "the loser's body: $(printf '%s' "$LOSER" | head -c 120)" ;;
esac
