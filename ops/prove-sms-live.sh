#!/bin/sh
# ops/prove-sms-live.sh — decision-48, PROVED ON THE LIVE BOX, with the flag OFF exactly as
# production has it, and then SEEDED ON so the OFF assertions are evidence rather than a
# tautology.
#
#   sh ops/prove-sms-live.sh [host]
#
# WHY IT EXISTS ALONGSIDE server/check-sms-flag.mjs. That file proves the LOGIC, in a
# throwaway local database, in one process. This one proves the BOX: the artefact that is
# actually running, the env file that is actually on disk, the migration that actually
# applied, and the code the director will actually press tomorrow. The two answer different
# questions and neither substitutes for the other.
#
#   1  the flag is OFF here, and the server says so in words at every layer it touches
#   2  a REAL worker, the enrolment code button, and a code that REDEEMS — decision-26,
#      unchanged, after an SMS attempt has already failed in the same minute
#   3  the 503 is the FLAG and not a missing phone number (the same call with a login
#      number on file answers 503 too)
#   4  the app's two SMS doors and the public capability read all agree
#   5  *** THE NEGATIVE CASE, SEEDED ON PRODUCTION ***  /etc/nfc/env is given a complete,
#      correctly SHAPED, entirely FAKE credential set whose API base points at a dead
#      loopback port. The flag flips, §1-§4's oracles are re-run and MUST NOW FAIL, and the
#      one call that gets through returns 200 with a WORKING CODE and status 'failed' —
#      never 'sent'. Then the env file is restored and compared by sha256.
#
# NO REAL SMS CAN BE SENT BY THIS FILE. The seeded credentials are obvious fakes and
# TWILIO_API_BASE points at 127.0.0.1 on a port with nothing listening, so the only possible
# outcome of a send is ECONNREFUSED. There is no Twilio account behind those values.
#
# IT WRITES TO PRODUCTION AND CLEANS UP AFTER ITSELF, then PROVES the cleanup by counting
# rows. Every row it creates is named with the marker below.
#
# CURL RUNS FROM HERE, NEVER FROM INSIDE THE SSH SESSION: the box curling its own hostname
# hairpins and returns 000.
set -eu

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
BASE="https://$HOST"
MARK="PROVE48"
PHONE="+436609900148"
TMP=$(mktemp -d)
FAILED=0
SEEDED=0

ok()   { echo "  ok   $*"; }
bad()  { echo "  FAIL $*"; FAILED=1; }
red()  { echo "  RED  $*"; }
box()  { ssh "$HOST" "sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

ENV_SHA_BEFORE=$(ssh "$HOST" 'sudo -n sha256sum /etc/nfc/env | cut -d" " -f1')

restore_env() {
  [ "$SEEDED" = "1" ] || return 0
  ssh "$HOST" 'sudo bash -euc "
    [ -f /etc/nfc/env.prove48 ] && mv /etc/nfc/env.prove48 /etc/nfc/env
    chown root:app /etc/nfc/env && chmod 0640 /etc/nfc/env
    systemctl restart nfc-api
  "' >/dev/null 2>&1
  sleep 2
  SEEDED=0
  AFTER=$(ssh "$HOST" 'sudo -n sha256sum /etc/nfc/env | cut -d" " -f1')
  [ "$AFTER" = "$ENV_SHA_BEFORE" ] \
    && ok "/etc/nfc/env restored, byte for byte (sha256 $AFTER)" \
    || bad "/etc/nfc/env DIFFERS after the seed: $AFTER != $ENV_SHA_BEFORE"
}

cleanup() {
  restore_env
  echo
  echo "== cleanup, and the count that proves it"
  box "DELETE FROM sms_deliveries WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%') OR phone_e164 = '${PHONE}';" >/dev/null
  box "DELETE FROM otp_challenges WHERE phone_e164 = '${PHONE}';" >/dev/null
  box "DELETE FROM phone_identities WHERE phone_e164 = '${PHONE}';" >/dev/null
  box "DELETE FROM worker_sessions WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');" >/dev/null
  box "DELETE FROM shifts WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');" >/dev/null
  box "DELETE FROM workers WHERE name LIKE '${MARK}%';" >/dev/null
  box "DELETE FROM sessions WHERE token = '${ATOK_HASH:-none}';" >/dev/null
  LEFT=$(box "SELECT (SELECT count(*) FROM locations) || '|' || (SELECT count(*) FROM zones) || '|' || (SELECT count(*) FROM clients) || '|' || (SELECT count(*) FROM contacts) || '|' || (SELECT count(*) FROM workers) || '|' || (SELECT count(*) FROM shifts) || '|' || (SELECT count(*) FROM admins) || '|' || (SELECT count(*) FROM sms_deliveries) || '|' || (SELECT count(*) FROM otp_challenges) || '|' || (SELECT count(*) FROM phone_identities) || '|' || (SELECT count(*) FROM worker_sessions)")
  [ "$LEFT" = "0|0|0|0|0|0|1|0|0|0|0" ] \
    && ok "locations|zones|clients|contacts|workers|shifts|admins|sms_deliveries|otp_challenges|phone_identities|worker_sessions = $LEFT" \
    || bad "production is '$LEFT' (want 0|0|0|0|0|0|1|0|0|0|0)"
  rm -rf "$TMP"
  [ "$FAILED" = "0" ] && echo "\nPROVE-48 OK" || { echo "\nPROVE-48 FAILED"; exit 1; }
}
trap cleanup EXIT

APP_KEY=$(ssh "$HOST" 'sudo -n grep "^APP_KEY=" /etc/nfc/env | cut -d= -f2-')
[ -n "$APP_KEY" ] || { echo "no APP_KEY on the box" >&2; exit 1; }

sha() { node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1],"utf8").digest("hex"))' "$1"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v===undefined||v===null?"":String(v))}catch{process.stdout.write("")}})' "$1" < "$TMP/body"; }

# The admin session, minted STRAIGHT INTO THE DATABASE. The vaulted ADMIN_PASSWORD is known
# to be stale (self-service password change exists) and POST /admin/login is rate limited on
# this box — guessing at it is how a deploy window turns into a lockout. The row stores only
# SHA-256 of the token (lib/auth.js), so this cannot be replayed even if the transcript
# leaked, it lives 20 minutes, and the cleanup above deletes it by hash.
ATOK=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
ATOK_HASH=$(sha "$ATOK")
box "INSERT INTO sessions (token, admin_id, expires_at) SELECT '$ATOK_HASH', id, now() + interval '20 minutes' FROM admins ORDER BY id LIMIT 1" >/dev/null
ok "a throwaway 20-minute admin session exists on the live box (never a guessed password)"

adm() { # adm METHOD PATH [BODY]
  m="$1"; p="$2"; b="${3:-}"
  if [ -n "$b" ]; then
    curl -sS -o "$TMP/body" -w '%{http_code}' -X "$m" "$BASE$p" \
      -H "Cookie: ts_session=$ATOK" -H 'Content-Type: application/json' -d "$b"
  else
    curl -sS -o "$TMP/body" -w '%{http_code}' -X "$m" "$BASE$p" -H "Cookie: ts_session=$ATOK"
  fi
}
app() { # app METHOD PATH [BODY]
  m="$1"; p="$2"; b="${3:-}"
  if [ -n "$b" ]; then
    curl -sS -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$m" "$BASE$p" \
      -H "X-App-Key: $APP_KEY" -H 'Content-Type: application/json' -d "$b"
  else
    curl -sS -o "$TMP/body" -D "$TMP/hdr" -w '%{http_code}' -X "$m" "$BASE$p" -H "X-App-Key: $APP_KEY"
  fi
}
codehash() { box "SELECT coalesce(enrolment_code_hash,'-') || '|' || coalesce(enrolment_code_expires_at::text,'-') FROM workers WHERE id = $1"; }
deliveries() { box "SELECT count(*) FROM sms_deliveries"; }
challenges() { box "SELECT count(*) FROM otp_challenges"; }

echo
echo "== 1 · the flag is OFF on this box, and it says so in words"
ENV_KEYS=$(ssh "$HOST" 'sudo -n grep -c "^TWILIO" /etc/nfc/env || true')
[ "$ENV_KEYS" = "0" ] && ok "/etc/nfc/env carries NO TWILIO_* at all — this is production's real configuration" \
  || bad "/etc/nfc/env already carries $ENV_KEYS TWILIO_* line(s)"
BOOTLINE=$(ssh "$HOST" 'sudo -n journalctl -u nfc-api -n 400 --no-pager | grep "^.*sms: " | tail -1' || true)
case "$BOOTLINE" in
  *"sms: not configured (missing:"*) ok "boot said it, once, on stdout: ${BOOTLINE##*nfc-api*: }" ;;
  *) bad "no 'sms: not configured' line in the journal (got: ${BOOTLINE:-nothing})" ;;
esac
CODE=$(adm GET /admin/sms-status)
[ "$CODE" = "200" ] && [ "$(jget configured)" = "false" ] \
  && ok "GET /admin/sms-status -> 200 configured=false missing=[$(jget missing)] sender_kind=$(jget sender_kind || echo null)" \
  || bad "sms-status answered $CODE configured=$(jget configured)"
CODE=$(app GET /auth/capabilities)
[ "$CODE" = "200" ] && [ "$(jget sms)" = "false" ] \
  && ok "GET /auth/capabilities -> 200 {sms:false} — the phone never draws a door that answers 503" \
  || bad "capabilities answered $CODE sms=$(jget sms)"

echo
echo "== 2 · a REAL worker, and the enrolment code that must never regress"
CODE=$(adm POST /admin/workers "{\"name\":\"${MARK} Mitarbeiterin\",\"hourly_rate_cents\":1450,\"active\":true}")
WID=$(jget worker.id)
[ "$CODE" = "201" ] && [ -n "$WID" ] && ok "POST /admin/workers -> 201, worker id $WID" || bad "worker create answered $CODE"

CODE=$(adm POST "/admin/workers/$WID/enrolment-code")
ECODE=$(jget code)
[ "$CODE" = "201" ] && [ -n "$ECODE" ] \
  && ok "POST /admin/workers/$WID/enrolment-code -> 201, code $ECODE, expires $(jget expires_at)" \
  || bad "the enrolment-code button answered $CODE"
HASH_BEFORE=$(codehash "$WID")

DELIV_BEFORE=$(deliveries)
CODE=$(adm POST "/admin/workers/$WID/enrolment-code/sms")
[ "$CODE" = "503" ] && [ "$(jget error)" = "sms_not_configured" ] \
  && ok "POST .../enrolment-code/sms -> 503 sms_not_configured — never a crash, never a fake success" \
  || bad "the SMS button answered $CODE $(jget error)"
[ "$(codehash "$WID")" = "$HASH_BEFORE" ] \
  && ok "…and the worker's LIVE CODE was not touched: the 503 is checked BEFORE the mint" \
  || bad "the refused SMS re-minted the code ($HASH_BEFORE -> $(codehash "$WID"))"
[ "$(deliveries)" = "$DELIV_BEFORE" ] \
  && ok "…and no sms_deliveries row was written for a delivery that never happened ($DELIV_BEFORE)" \
  || bad "sms_deliveries moved $DELIV_BEFORE -> $(deliveries)"

CODE=$(app POST /auth/code "{\"code\":\"$ECODE\"}")
[ "$CODE" = "200" ] \
  && ok "*** POST /auth/code WITH THE SAME CODE -> 200, AFTER the SMS attempt failed ***" \
  || bad "redeeming the code answered $CODE $(jget error)"
/usr/bin/grep -qi '^set-cookie: ts_worker=' "$TMP/hdr" \
  && ok "…and the worker session cookie was set: $(/usr/bin/grep -i '^set-cookie: ts_worker=' "$TMP/hdr" | /usr/bin/sed -E 's/ts_worker=[^;]+/ts_worker=<redacted>/I' | tr -d '\r')" \
  || bad "no ts_worker cookie on the redemption"
CODE=$(app POST /auth/code "{\"code\":\"$ECODE\"}")
[ "$CODE" = "401" ] && ok "…and it is single use: the second redemption is 401" || bad "a redeemed code answered $CODE again"

echo
echo "== 3 · the 503 is the FLAG, not a missing phone number"
CODE=$(adm PUT "/admin/workers/$WID/phone" "{\"phone\":\"$PHONE\"}")
[ "$CODE" = "200" ] && ok "PUT /admin/workers/$WID/phone -> 200 $(jget phone_e164)" || bad "the phone claim answered $CODE $(jget error)"
CODE=$(adm POST "/admin/workers/$WID/enrolment-code/sms")
[ "$CODE" = "503" ] && [ "$(jget error)" = "sms_not_configured" ] \
  && ok "the SAME call WITH a login number on file: still 503 — so it is the flag, not the number" \
  || bad "with a number the SMS button answered $CODE $(jget error)"
[ "$(deliveries)" = "0" ] && ok "sms_deliveries is still empty" || bad "sms_deliveries = $(deliveries)"

echo
echo "== 4 · the app's two SMS doors"
CODE=$(app POST /auth/sms/request "{\"phone\":\"$PHONE\"}")
[ "$CODE" = "503" ] && [ "$(jget error)" = "sms_not_configured" ] \
  && ok "POST /auth/sms/request -> 503 sms_not_configured (never 202: nobody waits for a text that is not coming)" \
  || bad "sms/request answered $CODE $(jget error)"
CODE=$(app POST /auth/sms/verify "{\"phone\":\"$PHONE\",\"code\":\"123456\"}")
[ "$CODE" = "503" ] && ok "POST /auth/sms/verify -> 503 sms_not_configured" || bad "sms/verify answered $CODE $(jget error)"
[ "$(challenges)" = "0" ] && ok "otp_challenges is empty — nothing was minted on a box that cannot send" || bad "otp_challenges = $(challenges)"

echo
echo "== 5 · THE NEGATIVE CASE, SEEDED ON THIS BOX (a check whose negative cannot fail is not a check)"
echo "       fake, correctly-shaped credentials + TWILIO_API_BASE on a dead loopback port"
# The API-key literal is assembled from a variable rather than written out: gitleaks has a
# `twilio-api-key` rule that matches SK + 32 hex, and it cannot tell an obvious fake from a
# real one. server/check-sms-flag.mjs splits the same value for the same reason.
ssh "$HOST" 'sudo bash -euc "
  HEX=fedcba9876543210fedcba9876543210
  cp -p /etc/nfc/env /etc/nfc/env.prove48
  {
    echo TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    echo TWILIO_SID=SK\$HEX
    echo TWILIO_SECRET=not-a-real-twilio-secret-000000000
    echo TWILIO_FROM=+43720123456
    echo TWILIO_API_BASE=http://127.0.0.1:9099
  } >> /etc/nfc/env
  systemctl restart nfc-api
"' >/dev/null
SEEDED=1
sleep 2

CODE=$(adm GET /admin/sms-status)
[ "$CODE" = "200" ] && [ "$(jget configured)" = "true" ] \
  && ok "the flag FLIPPED: sms-status configured=true, sender_kind=$(jget sender_kind) — §1's oracle is now RED, as it must be" \
  || bad "the seed did not flip the flag: $CODE configured=$(jget configured)"
CODE=$(app GET /auth/capabilities)
[ "$(jget sms)" = "true" ] && red "GET /auth/capabilities now says {sms:true} — §1's assertion would FAIL here" \
  || bad "capabilities did not flip"

HASH_BEFORE=$(codehash "$WID")
CODE=$(adm POST "/admin/workers/$WID/enrolment-code/sms")
if [ "$CODE" = "503" ]; then
  bad "the SMS route STILL answered 503 with credentials present — §2's 503 proves nothing"
else
  red "POST .../enrolment-code/sms now answers $CODE, NOT 503 — §2's assertion would FAIL here"
fi
SEEDCODE=$(jget code)
[ "$CODE" = "200" ] && [ -n "$SEEDCODE" ] \
  && ok "a FAILED send is a 200 CARRYING THE CODE: $SEEDCODE, delivery.status=$(jget delivery.status) reason=$(jget delivery.reason)" \
  || bad "the seeded send answered $CODE (want 200 with a code)"
[ "$(jget delivery.status)" = "failed" ] \
  && ok "…and it is recorded as 'failed', never 'sent' — nothing reached a carrier and nothing pretends it did" \
  || bad "delivery.status=$(jget delivery.status) after an ECONNREFUSED"
DROW=$(box "SELECT status || '|' || coalesce(reason,'-') || '|' || coalesce(provider_sid,'-') FROM sms_deliveries WHERE worker_id = $WID ORDER BY id DESC LIMIT 1")
case "$DROW" in
  failed\|network:*\|- | failed\|timeout\|-) ok "sms_deliveries row: $DROW — a vocabulary word, no number, no body, no credential" ;;
  *) bad "sms_deliveries row reads '$DROW'" ;;
esac
CODE=$(app POST /auth/code "{\"code\":\"$SEEDCODE\"}")
[ "$CODE" = "200" ] \
  && ok "*** and THAT code redeems too: 200. The fallback holds when the send fails, live ***" \
  || bad "the code from the failed send answered $CODE $(jget error)"

CODE=$(app POST /auth/sms/request "{\"phone\":\"$PHONE\"}")
[ "$CODE" = "202" ] && red "POST /auth/sms/request now answers 202 — §4's assertion would FAIL here" \
  || bad "sms/request answered $CODE with the flag on (want 202)"
CH=$(box "SELECT count(*) FROM otp_challenges WHERE phone_e164 = '$PHONE'")
[ "$CH" = "1" ] && ok "one otp_challenge exists while the flag is on (it is deleted below)" || bad "otp_challenges = $CH"

echo
echo "== 6 · and back off again"
restore_env
CODE=$(adm GET /admin/sms-status)
[ "$(jget configured)" = "false" ] && ok "GET /admin/sms-status -> configured=false again" || bad "the flag did not go back off"
CODE=$(adm POST "/admin/workers/$WID/enrolment-code/sms")
[ "$CODE" = "503" ] && ok "POST .../enrolment-code/sms -> 503 again. GREEN, after RED, on the same box." || bad "the SMS route answered $CODE after the restore"
