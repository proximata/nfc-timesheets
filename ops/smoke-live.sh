#!/usr/bin/env bash
#
# Smoke-test the LIVE API host end to end, then leave the database exactly as it was found.
#
#   ./ops/smoke-live.sh [host]        # host defaults to ops/branding.json apiHost
#
# WHY THIS EXISTS AND WHY IT WRITES ROWS.
#
# Every check in this repo before it ran against a scratch database, a restored dump or a
# fake card. All of them passed while production answered 404 to every route they described,
# because none of them ever asked production anything (backlog/docs/CORE-FLOW.md §1: "Both
# reports drove the flow against a LOCAL server. Nobody looked at production."). A deploy is
# exactly the moment that gap costs something, so this one talks to the real box.
#
# A read-only smoke test would prove the process is up and nothing else. The four features
# this deploy exists to ship — self-update, the tag write's report, the admin resolve, and
# the tap that must still open a shift — are all WRITES. So this creates a marked worker, a
# marked operator, a reported tag, a zone and a shift, drives the whole chain through the
# real HTTP surface, and deletes all of it again.
#
# THE CLEANUP IS THE DANGEROUS HALF, so it is built the way ops/delete-worker.sql is:
#   * everything it creates is named with the SMOKE_MARK prefix, and every DELETE is scoped
#     by that prefix — never by "the newest row", never by a bare id;
#   * it runs from a trap, so a failed assertion or a Ctrl-C still cleans up;
#   * phone_identities rows go FIRST. Its FKs are ON DELETE SET NULL under a
#     CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL), so deleting the operator
#     while its phone row survives makes Postgres try to write (NULL, NULL) and abort the
#     whole transaction (007 names this trap; ops/delete-worker.sql handles the same one);
#   * afterwards it re-counts every table it touched and FAILS if a single row is left,
#     and it re-asserts that the one real building is still there, still active, still
#     carrying its coordinates.
#
# It never touches: the admin row, the HOIV location row, or anything it did not create.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
BASE="https://$HOST"
SMOKE_MARK="SMOKE-DELETE-ME"
SMOKE_PHONE="+436811111111"

APP_KEY="${APP_KEY:-$(psst get APP_KEY 2>/dev/null || true)}"
[ -n "$APP_KEY" ] || { echo "FATAL: APP_KEY not in env or psst" >&2; exit 1; }

# THE ADMIN IDENTITY IS THIS SCRIPT'S OWN, AND IT IS THROWAWAY.
# The live admin row belongs to the DIRECTOR (email `schimmer`). His password is not in the
# vault — the vault's ADMIN_PASSWORD is an older login that no longer exists on this box —
# and the only ways to drive the admin API as him would be to know it or to RESET it. A
# smoke test that silently changes the client's password is a worse outcome than an
# untested route, so the test brings its own admin, uses it for about a minute, and the
# cleanup trap deletes it. ops/smoke-admin.mjs refuses any email without the marker, so no
# invocation of it can reach the director's row.
SMOKE_ADMIN_EMAIL="smoke-delete-me@localhost.invalid"
SMOKE_ADMIN_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"

TMP="$(mktemp -d)"
ADMIN_JAR="$TMP/admin.cookies"
WORKER_JAR="$TMP/worker.cookies"
OP_JAR="$TMP/operator.cookies"

FAILED=0
ok()   { printf '  ok:   %s\n' "$1"; }
bad()  { printf '  FAIL: %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

# --- the cleanup, defined before anything can create a row -------------------------------
psql_box() { ssh "$HOST" "sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

cleanup() {
  local rc=$?
  section "cleanup — every row this run created, scoped by the marker"
  psql_box "
    BEGIN;
    DELETE FROM shifts   WHERE worker_id   IN (SELECT id FROM workers   WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM material_requests WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM worker_sessions   WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM operator_sessions WHERE operator_id IN (SELECT id FROM operators WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM phone_identities  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${SMOKE_MARK}%')
                                     OR operator_id IN (SELECT id FROM operators WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM tag_aliases  WHERE zone_id IN (SELECT id FROM zones WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM reported_tags WHERE reported_by_operator_id IN (SELECT id FROM operators WHERE name LIKE '${SMOKE_MARK}%');
    DELETE FROM zones     WHERE name LIKE '${SMOKE_MARK}%';
    DELETE FROM workers   WHERE name LIKE '${SMOKE_MARK}%';
    DELETE FROM operators WHERE name LIKE '${SMOKE_MARK}%';
    COMMIT;" >/dev/null || { echo "  FAIL: cleanup TRANSACTION FAILED — rows may survive" >&2; rc=1; FAILED=1; }

  # The throwaway admin, and its sessions with it (ON DELETE CASCADE on sessions.admin_id).
  local gone
  gone=$(ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs delete $SMOKE_ADMIN_EMAIL'" 2>&1 | tail -1)
  [ "$gone" = "deleted 1" ] && ok "the throwaway admin is gone ($gone)" || bad "throwaway admin: $gone"

  # Not "the deletes ran" — "nothing is left". Counted from the database, after the fact.
  local left
  left=$(psql_box "SELECT
      (SELECT count(*) FROM workers)   || ' workers, ' ||
      (SELECT count(*) FROM operators) || ' operators, ' ||
      (SELECT count(*) FROM shifts)    || ' shifts, ' ||
      (SELECT count(*) FROM zones)     || ' zones, ' ||
      (SELECT count(*) FROM reported_tags) || ' reported_tags, ' ||
      (SELECT count(*) FROM tag_aliases)   || ' tag_aliases, ' ||
      (SELECT count(*) FROM phone_identities) || ' phone_identities, ' ||
      (SELECT count(*) FROM locations) || ' locations, ' ||
      (SELECT count(*) FROM admins)    || ' admins'")
  echo "  after: $left"
  case "$left" in
    "0 workers, 0 operators, 0 shifts, 0 zones, 0 reported_tags, 0 tag_aliases, 0 phone_identities, 1 locations, 1 admins")
      ok "production is exactly as it was found" ;;
    *)
      bad "production is NOT as it was found — see the counts above"; rc=1 ;;
  esac

  # The building on the wall, re-read after everything.
  local hoiv
  hoiv=$(psql_box "SELECT slug || '|' || active || '|' || coalesce(lat::text,'NULL') || '|' || coalesce(lng::text,'NULL') FROM locations")
  [ "$hoiv" = "hoiv-arsenalstrasse-11|true|48.1761151|16.3953038" ] \
    && ok "HOIV untouched and still pinned: $hoiv" \
    || { bad "HOIV row changed: $hoiv"; rc=1; }

  rm -rf "$TMP"
  if [ "$FAILED" -ne 0 ]; then
    echo; echo "SMOKE FAILED"; exit 1
  fi
  echo; echo "SMOKE OK — $BASE"
  exit "$rc"
}
trap cleanup EXIT

# --- tiny HTTP helpers --------------------------------------------------------------------
# Every call prints STATUS then BODY into $TMP/last, so an assertion can look at both.
req() { # req METHOD PATH [--jar file] [--key] [--data json]
  local method="$1" path="$2"; shift 2
  local args=(-sS --max-time 30 -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path")
  while [ $# -gt 0 ]; do
    case "$1" in
      --jar)  args+=(-b "$2" -c "$2"); shift 2 ;;
      --key)  args+=(-H "X-App-Key: $APP_KEY"); shift ;;
      --data) args+=(-H "Content-Type: application/json" --data "$2"); shift 2 ;;
    esac
  done
  curl "${args[@]}"
}
body()  { cat "$TMP/body"; }
jget()  { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v={}};for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v??""))})' "$1" < "$TMP/body"; }

# $1 expected status, $2 method, $3 path, rest: req args
expect() {
  local want="$1" method="$2" path="$3"; shift 3
  local got; got=$(req "$method" "$path" "$@")
  if [ "$got" = "$want" ]; then ok "$method $path -> $got"
  else bad "$method $path -> $got (want $want)  body: $(body | cut -c1-160)"; fi
}

echo "smoke-testing $BASE   (marker: $SMOKE_MARK)"

# =========================================================================================
section "0 · liveness and the static admin export"
expect 200 GET /health
ok "health body: $(body)"

# The admin panel is a static export served by the same process (decision-16). Each of these
# is a ROUTE THAT DID NOT EXIST before this deploy or one the director uses daily; a 404 here
# is a half-shipped bundle, which is precisely what step 3/4 of a deploy can leave behind.
for page in / /tags/ /operators/ /workers/ /locations/ /shifts/ /payroll/ /pl/ /analytics/ \
            /clients/ /contracts/ /inventory/ /material-requests/ /reinigung/ /account/ /login/; do
  expect 200 GET "$page"
done

# =========================================================================================
section "1 · the gates: every protected surface refuses before it is asked nicely"
expect 401 GET  /admin/data
expect 401 GET  /admin/analytics
expect 401 POST /admin/workers --data '{"name":"nope","hourly_rate_cents":100}'
expect 401 GET  /roster              --key         # app key, but no WORKER session
expect 401 POST /shifts/open         --key --data '{"client_uuid":"3f2504e0-4f89-11d3-9a0c-0305e82c3301","location_uuid":"00000000-0000-4000-9999-000000000000","start_time":"2026-08-20T10:00:00Z"}'
expect 401 GET  /shifts/mine         --key
expect 401 POST /operator/tags       --key --data '{"id":"3f2504e0-4f89-11d3-9a0c-0305e82c3302"}'
expect 401 POST /auth/logout         --key

# =========================================================================================
section "2 · admin session and every read surface the director lands on"
# Created only now, so a failure in §0/§1 never leaves a credential on the box.
CREATED=$(printf '%s' "$SMOKE_ADMIN_PASSWORD" | ssh "$HOST" \
  "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs create $SMOKE_ADMIN_EMAIL'" 2>&1 | tail -1)
case "$CREATED" in created\ *) ok "throwaway admin $CREATED" ;;
  *) bad "could not create the throwaway admin: $CREATED"; exit 1 ;; esac

expect 200 POST /admin/login --jar "$ADMIN_JAR" \
  --data "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$SMOKE_ADMIN_EMAIL" "$SMOKE_ADMIN_PASSWORD")"
# Everything below needs that session; without it every assertion turns into the same
# 401 and the real failure is buried a hundred lines up.
[ "$FAILED" = "0" ] || { echo "  (admin login failed — stopping here)"; exit 1; }

# The password is a REAL credential while the row exists: prove the wrong one is refused,
# i.e. that the login this test just passed was not passing for everyone.
expect 401 POST /admin/login --data \
  "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:"not-the-password"}))' "$SMOKE_ADMIN_EMAIL")"
expect 200 GET /admin/session   --jar "$ADMIN_JAR"
expect 200 GET /admin/data      --jar "$ADMIN_JAR"
# ONE building, and everything below drives THAT one. Not a style point: seeding a second
# location during the red-first run silently shifted every `locations.0` by one, and the
# tap then ran against the decoy while the real building sat inactive — three assertions
# that should have gone red stayed green because they were reading a different row. An
# ordinal is only a name when you already know how many there are.
LOC_COUNT=$(jget locations.length)
[ "$LOC_COUNT" = "1" ] && ok "exactly one building, so locations.0 IS the building on the wall" \
  || { bad "$LOC_COUNT buildings — this test picks locations.0 and can no longer know which one that is"; exit 1; }
LOCATION_ID=$(jget locations.0.id)
ok "the one building: $LOCATION_ID ($(jget locations.0.slug))"
# The reporting routes take an explicit range and REFUSE to invent one (v.requiredRange) —
# a report whose period was guessed for you is a payroll number nobody chose.
# Full ISO timestamps, not bare dates: v.requiredRange takes an instant, because a "day"
# is not one — the period boundaries are Vienna-local and DST-aware (decision-6 territory).
RANGE="from=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)&to=$(date -u +%Y-%m-%dT23:59:59Z)"
expect 200 GET "/admin/analytics?$RANGE" --jar "$ADMIN_JAR"
expect 200 GET "/admin/pl?$RANGE"        --jar "$ADMIN_JAR"
expect 200 GET "/admin/revenue?$RANGE"   --jar "$ADMIN_JAR"
expect 200 GET "/admin/locations/$LOCATION_ID/contracts" --jar "$ADMIN_JAR"
# ...and the refusal itself, so "200" above is not just "this route ignores its input".
expect 400 GET /admin/analytics --jar "$ADMIN_JAR"

# decision-43: an unzoned building is GREY, never gone. Read off the LIVE analytics payload,
# not off a fixture, against whichever building this box's own data actually holds.
req GET "/admin/analytics?$RANGE" --jar "$ADMIN_JAR" >/dev/null
ZSTATE=$(jget buildings.0.zone_state); ZACTIVE=$(jget buildings.0.active)
[ "$ZSTATE" = "unzoned" ] && ok "the one building: zone_state=unzoned" || bad "zone_state='$ZSTATE' (want unzoned)"
[ "$ZACTIVE" = "true" ]   && ok "the one building: still active on /admin/analytics" || bad "active='$ZACTIVE' (want true)"

# =========================================================================================
section "3 · the operator half: create, enrol, report a tag (all four were 404 an hour ago)"
expect 201 POST /admin/operators --jar "$ADMIN_JAR" \
  --data "{\"name\":\"$SMOKE_MARK operator\",\"phone\":\"$SMOKE_PHONE\"}"
OPERATOR_ID=$(jget operator.id)
ok "operator id $OPERATOR_ID"

expect 201 POST "/admin/operators/$OPERATOR_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}'
OP_CODE=$(jget code)
[ -n "$OP_CODE" ] && ok "an enrolment code was issued (not printed)" || bad "no code in the response"

expect 200 POST /auth/operator-code --key --jar "$OP_JAR" \
  --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$OP_CODE")"
/usr/bin/grep -q ts_operator "$OP_JAR" && ok "an operator session cookie was set" || bad "no ts_operator cookie"

# A code is SINGLE USE. Redeeming it twice must fail — the same property 004 gives workers.
expect 401 POST /auth/operator-code --key \
  --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$OP_CODE")"

# The tag the operator's phone just "wrote". A fresh uuid, minted client-side.
TAG_ID=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
ok "fresh tag id $TAG_ID"
expect 201 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$TAG_ID\"}"
# Idempotent: the same physical tag reported twice is one row, answered 200.
expect 200 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$TAG_ID\"}"
ROWS=$(psql_box "SELECT count(*) FROM reported_tags WHERE id = '$TAG_ID'")
[ "$ROWS" = "1" ] && ok "exactly one reported_tags row for two reports" || bad "reported_tags rows: $ROWS"
UNBOUND=$(psql_box "SELECT resolved_at IS NULL FROM reported_tags WHERE id = '$TAG_ID'")
[ "$UNBOUND" = "t" ] && ok "it landed UNBOUND — no zone, no building, nothing claimed" || bad "resolved_at is already set"

# =========================================================================================
section "4 · a worker, and the tap that must never have stopped working"
expect 201 POST /admin/workers --jar "$ADMIN_JAR" \
  --data "{\"name\":\"$SMOKE_MARK worker\",\"hourly_rate_cents\":1450,\"active\":true}"
WORKER_ID=$(jget worker.id)
ok "worker id $WORKER_ID (rate 1450 — 006 makes a rate-less worker unrepresentable)"

expect 201 POST "/admin/workers/$WORKER_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}'
W_CODE=$(jget code)
expect 200 POST /auth/code --key --jar "$WORKER_JAR" \
  --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$W_CODE")"
/usr/bin/grep -q ts_worker "$WORKER_JAR" && ok "a worker session cookie was set" || bad "no ts_worker cookie"
expect 200 GET /roster --key --jar "$WORKER_JAR"
expect 200 GET "/shifts/mine?since=$(date -u -v-7d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z)" --key --jar "$WORKER_JAR"

# THE CARD ON THE WALL. Old-shape body — client_uuid + location_uuid + start_time, exactly
# what the APK in the field sends, with no zone field anywhere. It must still open a shift
# after 006/007/008; this is the one regression that would be felt by a human tomorrow.
CLIENT_UUID=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
expect 201 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$CLIENT_UUID\",\"location_uuid\":\"$LOCATION_ID\",\"start_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
SHIFT_ID=$(jget shift.id); SZONE=$(jget shift.start_zone_id)
[ -n "$SHIFT_ID" ] && ok "shift $SHIFT_ID opened on the wall uuid" || bad "no shift id came back"
[ -z "$SZONE" ] && ok "start_zone_id is NULL — an unzoned building invents no zone" || bad "start_zone_id=$SZONE"
# Idempotency key: the same tap retried on flaky wifi is the same shift, not a second one.
expect 200 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$CLIENT_UUID\",\"location_uuid\":\"$LOCATION_ID\",\"start_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
COUNT=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$CLIENT_UUID'")
[ "$COUNT" = "1" ] && ok "one tap, one shift, even retried" || bad "shifts for that client_uuid: $COUNT"

# THE UNBOUND TAG MUST BE HARMLESS. Same worker, same session, the tag reported in §3 —
# which no admin has claimed. 422, a named reason, and NO shift row.
BEFORE=$(psql_box "SELECT count(*) FROM shifts")
expect 422 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')\",\"location_uuid\":\"$TAG_ID\",\"start_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
REASON=$(jget error)
[ "$REASON" = "tag_unbound" ] && ok "refused as tag_unbound — the app has a German sentence for exactly this" \
                              || bad "refused as '$REASON' (want tag_unbound)"
AFTER=$(psql_box "SELECT count(*) FROM shifts")
[ "$BEFORE" = "$AFTER" ] && ok "no shift row was created by the unbound tap ($BEFORE = $AFTER)" \
                         || bad "shift count moved $BEFORE -> $AFTER"

# =========================================================================================
section "5 · the admin resolve: the office turns that tag into a zone, and the tap works"
expect 201 POST "/admin/tags/$TAG_ID/resolve-zone" --jar "$ADMIN_JAR" \
  --data "{\"location_id\":\"$LOCATION_ID\",\"name\":\"$SMOKE_MARK zone\",\"area_sqm\":42}"
ZONE_ID=$(jget zone.id)
[ "$ZONE_ID" = "$TAG_ID" ] && ok "the zone IS the tag id — no second id space (decision-37/44)" \
                           || bad "zone id $ZONE_ID != tag id $TAG_ID"
RESOLVED=$(psql_box "SELECT resolved_at IS NOT NULL FROM reported_tags WHERE id = '$TAG_ID'")
[ "$RESOLVED" = "t" ] && ok "the reported tag is now resolved" || bad "reported tag still unresolved"

# The SAME tap that was refused sixty seconds ago now opens a shift, and carries the zone.
# The worker is still clocked in at HOIV, and a second building while one shift is open is a
# 409 by design — so close the first one the way the app does: by tapping again, never by a
# button (there is no in-app close).
expect 200 POST /shifts/close --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$CLIENT_UUID\",\"location_uuid\":\"$LOCATION_ID\",\"end_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
CLIENT_UUID2=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
expect 201 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$CLIENT_UUID2\",\"location_uuid\":\"$TAG_ID\",\"start_time\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
SZONE2=$(jget shift.start_zone_id)
[ "$SZONE2" = "$TAG_ID" ] && ok "the shift carries start_zone_id = the tag" || bad "start_zone_id='$SZONE2'"

# =========================================================================================
section "6 · the association files, from the outside"
./server/wellknown/verify.sh "$HOST" --host-override >/dev/null 2>&1 \
  && ok "API host serves both association files (full check ran in deploy.sh step 7)" \
  || bad "the API host's association files did NOT verify"
./server/wellknown/verify.sh >/dev/null 2>&1 \
  && ok "TAG host (the one on the walls) verifies" \
  || bad "THE TAG HOST DID NOT VERIFY — tags are dead until this is fixed"
