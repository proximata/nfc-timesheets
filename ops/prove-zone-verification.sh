#!/bin/sh
# ops/prove-zone-verification.sh — decision-47, PROVED ON THE LIVE BOX, against the real
# HOIV row and the real card uuid that is screwed to a wall in Arsenalstrasse.
#
#   sh ops/prove-zone-verification.sh [host]
#
# WHY A SEPARATE, SMALL SCRIPT and not more of ops/prove-live.sh: prove-live drives the
# Android half (a phone, a mocked NFC write, an APK comparison) and takes minutes. This one
# answers exactly the four questions decision-47 introduced, in about ten seconds, over HTTP,
# from a laptop — which is what you want in a deploy window.
#
#   1  the WALL CARD still clocks a worker in, with an UNVERIFIED zone under its building
#   2  that zone's OWN id is refused 422 zone_unverified and writes NO shift row
#   3  the operator's test scan verifies it and CREATES NO SHIFT
#   4  once verified, the same tap opens a shift; and POST /admin/tags/:id/resolve-building
#      is GONE (404 at the router)
#
# IT WRITES TO PRODUCTION AND CLEANS UP AFTER ITSELF, then PROVES the cleanup by counting
# rows: production must end with exactly the building it started with, no zones, no shifts,
# no workers and no operators. Every row it creates is named with the marker below.
#
# CURL RUNS FROM HERE, NEVER FROM INSIDE THE SSH SESSION: the box curling its own hostname
# hairpins and returns 000.
set -eu

# THE CLEANUP REPORT GOES TO FD 3, AND FD 3 IS THE REAL STDOUT, SAVED HERE BEFORE ANY
# REDIRECTION EXISTS. Measured on 2026-08-23, bash 3.2 (macOS /bin/sh): when `set -e` fires
# inside `box "..." >/dev/null`, the EXIT trap runs WITH THAT REDIRECTION STILL IN EFFECT,
# so every line the cleanup prints goes to /dev/null. This run aborted at §2 against a wiped
# production database and printed the psql error and NOTHING ELSE — no cleanup header, no row
# counts, no verdict. The rows really were deleted; the proof that they were was thrown away,
# on exactly the path where somebody needs it most.
#
# Putting the redirection inside `box` does not fix it (the trap inherits whatever is active
# at whatever depth errexit fires). Saving the fd does.
exec 3>&1

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
BASE="https://$HOST"
WALL_ID="c3c37d4a-ca0a-42c5-b248-9704b9907ec7"
MARK="PROVE47"
TMP=$(mktemp -d)
FAILED=0
# 1 once this run has created the wall-card building itself, because the box did not have
# one. Set from PROVE47_SEED_WALL=1 only — never guessed. See the block below.
SEEDED_WALL=0
# What `locations` must read at the end: the building we found (1), or none at all (0)
# because we made the only one there was and took it away again.
WANT_LOCATIONS=1

ok()  { echo "  ok   $*" >&3; }
bad() { echo "  FAIL $*" >&3; FAILED=1; }
say() { echo "$@" >&3; }
box() { ssh "$HOST" "sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

cleanup() {
  say
  say "== cleanup, and the count that proves it"
  box "DELETE FROM shifts WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');" >/dev/null
  box "DELETE FROM worker_sessions WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');" >/dev/null
  box "DELETE FROM operator_sessions WHERE operator_id IN (SELECT id FROM operators WHERE name LIKE '${MARK}%');" >/dev/null
  box "DELETE FROM zones WHERE name LIKE '${MARK}%';" >/dev/null
  box "DELETE FROM workers WHERE name LIKE '${MARK}%';" >/dev/null
  box "DELETE FROM operators WHERE name LIKE '${MARK}%';" >/dev/null
  # The building this run MADE goes away with everything else it made. A row seeded by a
  # proof script is not a building; leaving it behind would put a fake address on the
  # director's map.
  [ "$SEEDED_WALL" = "1" ] && box "DELETE FROM locations WHERE id = '$WALL_ID';" >/dev/null
  LEFT=$(box "SELECT (SELECT count(*) FROM zones) || '|' || (SELECT count(*) FROM shifts) || '|' || (SELECT count(*) FROM workers) || '|' || (SELECT count(*) FROM operators) || '|' || (SELECT count(*) FROM locations)")
  [ "$LEFT" = "0|0|0|0|$WANT_LOCATIONS" ] \
    && ok "production is zones=0 shifts=0 workers=0 operators=0 locations=$WANT_LOCATIONS — exactly as found" \
    || bad "production is '$LEFT' (want 0|0|0|0|$WANT_LOCATIONS)"
  # `active::text` through the `||` operator is 'true'/'false', NOT psql's bare-boolean 't'.
  # Getting that wrong made this line fail against a perfectly healthy row on its first run.
  HOIV=$(box "SELECT active || '|' || coalesce(lat::text,'-') || '|' || coalesce(lng::text,'-') FROM locations WHERE id = '$WALL_ID'")
  if [ "$SEEDED_WALL" = "1" ]; then
    [ -z "$HOIV" ] && ok "the seeded wall-card building is gone again" || bad "the seeded building survived: '$HOIV'"
  else
    case "$HOIV" in
      true\|*.*\|*.*) ok "HOIV is untouched, active and pinned: $HOIV" ;;
      *) bad "HOIV reads '$HOIV' (want true|<lat>|<lng>)" ;;
    esac
  fi
  rm -rf "$TMP"
  [ "$FAILED" = "0" ] && say "\nPROVE-47 OK" || { say "\nPROVE-47 FAILED"; exit 1; }
}
trap cleanup EXIT

APP_KEY=$(ssh "$HOST" 'sudo -n grep "^APP_KEY=" /etc/nfc/env | cut -d= -f2-')
[ -n "$APP_KEY" ] || { echo "no APP_KEY on the box" >&2; exit 1; }

# THE FIXTURE THIS FILE WAS WRITTEN AGAINST CAN BE ABSENT NOW. Every section below hangs off
# ONE building — the real HOIV row, whose uuid is written on a card in Arsenalstrasse — and
# on 2026-08-23 production was wiped to zero locations on the owner's instruction. Without
# the row, §2's very first INSERT dies on a foreign key and decision-47 goes UNMEASURED.
#
# IT REFUSES BY DEFAULT AND SAYS WHY, rather than quietly creating the building: on a box
# that is SUPPOSED to have it, "the wall card is missing" is the single most important thing
# this script could ever tell anyone, and a script that repairs that on its own would delete
# the finding. PROVE47_SEED_WALL=1 is the deliberate way past it, and what it creates is
# removed again in the cleanup above.
HAVE_WALL=$(box "SELECT count(*) FROM locations WHERE id = '$WALL_ID'")
if [ "$HAVE_WALL" = "0" ]; then
  if [ "${PROVE47_SEED_WALL:-}" = "1" ]; then
    box "INSERT INTO locations (id, slug, name, address, lat, lng, active) VALUES ('$WALL_ID', '${MARK}-wall-card', '${MARK} Wandkarte', 'Arsenalstrasse, 1030 Wien', 48.1845, 16.3892, true)" >/dev/null
    SEEDED_WALL=1
    WANT_LOCATIONS=0
    ok "PROVE47_SEED_WALL=1: the wall-card building did not exist, so this run made it (and takes it away again)"
  else
    echo "FATAL: no location $WALL_ID on $HOST — the card on the wall names a building that" >&2
    echo "       is not in the database. On a live box that is an INCIDENT, not a test setup" >&2
    echo "       problem: every tap on that card is unresolvable. If this is a wiped or fresh" >&2
    echo "       database and you only want to exercise decision-47, re-run with" >&2
    echo "       PROVE47_SEED_WALL=1 and this script will create the building and remove it." >&2
    # NOTHING HAS BEEN CREATED YET, so there is nothing to clean and no verdict to give.
    # Leaving the trap armed would print a cleanup section and a row-count FAIL for a run
    # that never started — two ways of saying the same missing building, one of which reads
    # like the script left a mess behind.
    trap - EXIT
    rm -rf "$TMP"
    exit 1
  fi
fi

# The two sessions, minted straight into the database: this file is about the ZONE gate, not
# about enrolment (that is prove-live's §3 and §6). The ROW stores only SHA-256 of the token
# (lib/auth.js), so neither of these can be replayed even if this transcript leaked, and both
# are deleted in the cleanup above.
WTOK=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
OTOK=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')
sha() { node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(process.argv[1],"utf8").digest("hex"))' "$1"; }

box "INSERT INTO workers (name, hourly_rate_cents) VALUES ('${MARK} Arbeiterin', 1500)" >/dev/null
box "INSERT INTO worker_sessions (token, worker_id, expires_at) SELECT '$(sha "$WTOK")', id, now() + interval '10 minutes' FROM workers WHERE name = '${MARK} Arbeiterin'" >/dev/null
box "INSERT INTO operators (name) VALUES ('${MARK} Betreiber')" >/dev/null
box "INSERT INTO operator_sessions (token, operator_id, expires_at) SELECT '$(sha "$OTOK")', id, now() + interval '10 minutes' FROM operators WHERE name = '${MARK} Betreiber'" >/dev/null
ok "a throwaway worker and operator session exist on the live box"

req() { # req METHOD PATH COOKIE [BODY]
  m="$1"; p="$2"; c="$3"; b="${4:-}"
  if [ -n "$b" ]; then
    curl -sS -o "$TMP/body" -w '%{http_code}' -X "$m" "$BASE$p" \
      -H "X-App-Key: $APP_KEY" -H "Cookie: $c" -H 'Content-Type: application/json' -d "$b"
  else
    curl -sS -o "$TMP/body" -w '%{http_code}' -X "$m" "$BASE$p" -H "X-App-Key: $APP_KEY" -H "Cookie: $c"
  fi
}
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v===undefined||v===null?"":String(v))}catch{process.stdout.write("")}})' "$1" < "$TMP/body"; }
uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }
now() { node -e 'process.stdout.write(new Date().toISOString())'; }
shifts() { box "SELECT count(*) FROM shifts"; }

echo
echo "== 1 · the retired route"
CODE=$(curl -sS -o "$TMP/body" -w '%{http_code}' -X POST "$BASE/admin/tags/$(uuid)/resolve-building" -H 'Content-Type: application/json' -d '{"slug":"x","name":"x"}')
[ "$CODE" = "404" ] && [ "$(jget error)" = "not_found" ] \
  && ok "POST /admin/tags/:id/resolve-building answers 404 not_found — the ROUTER, no handler exists" \
  || bad "resolve-building answered $CODE $(jget error)"

echo
echo "== 2 · an UNVERIFIED zone under HOIV, and the card on the wall"
box "INSERT INTO zones (location_id, name) VALUES ('$WALL_ID', '${MARK} Teststiege')" >/dev/null
ZONE=$(box "SELECT id FROM zones WHERE name = '${MARK} Teststiege'")
[ "$(box "SELECT verified_at IS NULL FROM zones WHERE id = '$ZONE'")" = "t" ] \
  && ok "the zone landed UNVERIFIED — 010 has no default, so nothing verified it by accident" \
  || bad "the zone was born verified"

BEFORE=$(shifts)
CODE=$(req POST /shifts/open "ts_worker=$WTOK" "{\"client_uuid\":\"$(uuid)\",\"location_uuid\":\"$ZONE\",\"start_time\":\"$(now)\"}")
[ "$CODE" = "422" ] && [ "$(jget error)" = "zone_unverified" ] \
  && ok "a tap on the unproven card: 422 zone_unverified" || bad "the unverified tap answered $CODE $(jget error)"
[ "$(shifts)" = "$BEFORE" ] && ok "…and NO shift row was created ($BEFORE)" || bad "the shift count moved $BEFORE -> $(shifts)"

WALL_TAP=$(uuid)
CODE=$(req POST /shifts/open "ts_worker=$WTOK" "{\"client_uuid\":\"$WALL_TAP\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$(now)\"}")
[ "$CODE" = "201" ] && ok "*** THE CARD ON THE WALL STILL CLOCKS A WORKER IN (201) ***" || bad "the wall card answered $CODE $(jget error)"
[ -z "$(jget shift.start_zone_id)" ] && ok "…with start_zone_id NULL — it did not acquire the zone next door" || bad "start_zone_id=$(jget shift.start_zone_id)"
CODE=$(req POST /shifts/close "ts_worker=$WTOK" "{\"client_uuid\":\"$WALL_TAP\",\"location_uuid\":\"$ZONE\",\"end_time\":\"$(now)\"}")
[ "$CODE" = "200" ] && ok "…and a clock-OUT through the UNVERIFIED door closes normally — never gated (INCIDENT 1)" || bad "the close answered $CODE $(jget error)"

echo
echo "== 3 · the operator's test scan"
CODE=$(req GET /operator/zones "ts_operator=$OTOK")
[ "$CODE" = "200" ] && ok "GET /operator/zones: the worklist" || bad "the worklist answered $CODE"
ON_LIST=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const z=(JSON.parse(s).zones||[]).find(z=>z.id===process.argv[1]);process.stdout.write(String(z?.verified_at===null))})' "$ZONE" < "$TMP/body")
[ "$ON_LIST" = "true" ] && ok "…and the unproven zone is on it" || bad "the zone is not on the operator's worklist"

BEFORE=$(shifts)
CODE=$(req POST "/operator/zones/$ZONE/verify" "ts_operator=$OTOK" "{\"place_uuid\":\"$WALL_ID\"}")
[ "$CODE" = "422" ] && [ "$(jget error)" = "zone_mismatch" ] \
  && ok "a BUILDING card cannot verify a zone: 422 zone_mismatch" || bad "the building card answered $CODE $(jget error)"
[ "$(box "SELECT verified_at IS NULL FROM zones WHERE id = '$ZONE'")" = "t" ] && ok "…and stamped nothing" || bad "a refused scan stamped the zone"

CODE=$(req POST "/operator/zones/$ZONE/verify" "ts_operator=$OTOK" "{\"place_uuid\":\"$ZONE\"}")
[ "$CODE" = "200" ] && [ "$(jget zone.already_verified)" = "false" ] && ok "the real card verifies it (200)" || bad "the test scan answered $CODE $(jget error)"
[ "$(shifts)" = "$BEFORE" ] && ok "*** A TEST SCAN CREATED NO SHIFT ($BEFORE) — the whole reason it is not a tap ***" || bad "the shift count moved during a TEST SCAN"
STAMP=$(box "SELECT verified_at FROM zones WHERE id = '$ZONE'")
CODE=$(req POST "/operator/zones/$ZONE/verify" "ts_operator=$OTOK" "{\"place_uuid\":\"$ZONE\"}")
[ "$CODE" = "200" ] && [ "$(jget zone.already_verified)" = "true" ] && ok "a re-scan is idempotent" || bad "the re-scan answered $CODE"
[ "$(box "SELECT verified_at FROM zones WHERE id = '$ZONE'")" = "$STAMP" ] && ok "…and the timestamp did not move" || bad "verified_at moved on a re-scan"
box "SELECT '       -> ' || z.name || ' verified_at=' || z.verified_at || ' by ' || coalesce(o.name,'NULL') FROM zones z LEFT JOIN operators o ON o.id = z.verified_by_operator_id WHERE z.id = '$ZONE'"

echo
echo "== 4 · and now a cleaner can clock in there"
ZONE_TAP=$(uuid)
CODE=$(req POST /shifts/open "ts_worker=$WTOK" "{\"client_uuid\":\"$ZONE_TAP\",\"location_uuid\":\"$ZONE\",\"start_time\":\"$(now)\"}")
[ "$CODE" = "201" ] && ok "the same tap that was refused two minutes ago: 201" || bad "the verified tap answered $CODE $(jget error)"
[ "$(jget shift.location_id)" = "$WALL_ID" ] && ok "…billed to the BUILDING (decision-43 §4)" || bad "location_id=$(jget shift.location_id)"
[ "$(jget shift.start_zone_id)" = "$ZONE" ] && ok "…with the door recorded as a tap FACT" || bad "start_zone_id=$(jget shift.start_zone_id)"
CODE=$(req POST /shifts/close "ts_worker=$WTOK" "{\"client_uuid\":\"$ZONE_TAP\",\"location_uuid\":\"$ZONE\",\"end_time\":\"$(now)\"}")
[ "$CODE" = "200" ] && ok "and out again" || bad "the close answered $CODE"
