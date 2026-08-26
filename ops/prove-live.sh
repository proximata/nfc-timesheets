#!/usr/bin/env bash
#
# DRIVE THE WHOLE PRODUCT AGAINST PRODUCTION, END TO END, AND LEAVE THE BOX AS IT WAS FOUND.
#
#     ./ops/prove-live.sh [host]        # host defaults to ops/branding.json apiHost
#
# WHAT IS DIFFERENT FROM ops/smoke-live.sh, WHICH ALREADY TALKS TO THE LIVE BOX.
#
# smoke-live proves every ROUTE answers on production. It mints its tag ids with
# crypto.randomUUID() and posts them, which is a fine test of the server and no test at all
# of the thing the server exists for: the id in that test never went near the code that
# writes a card, so a phone that writes the wrong bytes, refuses every card, or overwrites a
# mounted one would leave every one of those assertions green.
#
# This one starts one step earlier — at the CARD. android/checks/live-flow.sh runs the real
# nfc/TagWriter (and the debug simulator that stands in for NFC hardware on an emulator)
# against fake cards, and the ids it emits are the ids reported here. The chain is unbroken
# from "the operator holds a blank NTAG213" to "a cleaner's tap closes a shift", and it runs
# against the row the cleaners actually tap rather than a fixture.
#
# EVIDENCE AT EVERY STEP, three kinds, because each one alone lies:
#   the ROW     — psql on the box. What is true.
#   the LOG     — journalctl -u nfc-api. That the box, not a cache, answered.
#   the SCREEN  — the German the phone renders (android/checks/.../screen-*.txt) and a real
#                 headless-Chrome screenshot of the live admin panel, logged in.
#
# IT WRITES. Every one of the four shipped features is a write; a read-only test proves the
# process is up and nothing else. The cleanup is built the way ops/delete-worker.sql and
# ops/smoke-live.sh are: a marker on everything created, every DELETE scoped by it, a trap
# so a failed assertion still cleans up, and a count afterwards that FAILS if a single row
# survives. The director's admin row, the HOIV location and the published APK are never
# touched.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

HOST="${1:-$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')}"
TAG_HOST="$(node -e 'process.stdout.write(require("./ops/branding.json").tagHost)')"
BASE="https://$HOST"
MARK="PROVE-DELETE-ME"
PROVE_SLUG="prove-delete-me-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(4).toString("hex"))')"

APP_KEY="${APP_KEY:-$(psst get APP_KEY 2>/dev/null || true)}"
[ -n "$APP_KEY" ] || { echo "FATAL: APP_KEY not in env or psst" >&2; exit 1; }

# Same posture as ops/smoke-live.sh: the live admin row belongs to the DIRECTOR and his
# password is not in the vault. This test brings its own admin, uses it for a few minutes,
# and the cleanup trap deletes it. ops/smoke-admin.mjs refuses any email without the marker.
# The prefix is not a style choice: ops/smoke-admin.mjs refuses outright any email that does
# not start with `smoke-delete-me`, which is what makes it impossible for this script to
# reach the director's row however wrong the rest of it goes.
ADMIN_EMAIL="smoke-delete-me-prove@localhost.invalid"
ADMIN_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"

TMP="$(mktemp -d)"
ADMIN_JAR="$TMP/admin.cookies"
WORKER_JAR="$TMP/worker.cookies"
OP_JAR="$TMP/operator.cookies"
SHOTS="$REPO/docs/media/prove-live"
PHONE="$TMP/phone"

FAILED=0
ok()      { printf '  ok:   %s\n' "$1"; }
bad()     { printf '  FAIL: %s\n' "$1"; FAILED=1; }
section() { printf '\n== %s\n' "$1"; }

psql_box() { ssh "$HOST" "sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

# ---- the cleanup, defined before anything can create a row -------------------------------
#
# ORDER IS THE WHOLE THING. shifts before workers and before locations; phone_identities
# before its operator (007's FKs are ON DELETE SET NULL under a CHECK that one of the two
# is non-null, so deleting the operator first makes Postgres try to write (NULL, NULL) and
# aborts the transaction); tag_aliases and zones before the location that owns them.
#
# The location this run CREATES is found by its marked slug, never by "the newest row" and
# never by an id captured in a variable that a mid-run failure might have left empty.
# WHAT IS ALLOWED TO POINT AT THE THINGS THIS RUN CREATES, read from the catalogue rather
# than from memory — the same posture ops/delete-worker.sql takes. A migration that adds a
# child table nobody updated this script for would otherwise leave rows behind AND still let
# the closing count pass, because the count only looks at the tables it already knows about.
KNOWN_CHILDREN="location_contracts.location_id location_revenue.location_id material_requests.location_id portal_grants.location_id shifts.location_id shifts.start_zone_id shifts.end_zone_id zones.location_id zones.verified_by_operator_id tag_aliases.zone_id tag_aliases.id material_requests.worker_id shifts.worker_id worker_sessions.worker_id phone_identities.worker_id phone_identities.operator_id operator_sessions.operator_id reported_tags.reported_by_operator_id"

# SET BY THE LAST LINE OF THE FILE, AND BY NOTHING ELSE. The cleanup trap runs on EVERY
# exit, including one caused by an unbound variable, a killed ssh or a Ctrl-C, and it used to
# report "PROVE-LIVE OK" purely because no assertion had gone red YET. A run that stops after
# § 4 has not proved §§ 5-10; it has proved nothing about them, which is not the same as
# passing. The cleanup itself still runs - a half-run must still leave production clean - but
# it cannot claim a pass it did not earn.
COMPLETED=0

cleanup() {
  local rc=$?
  section "cleanup — every row this run created, scoped by the marker"

  local unknown
  unknown=$(psql_box "
    SELECT string_agg(child, ' ') FROM (
      SELECT DISTINCT c.conrelid::regclass::text || '.' || a.attname AS child
        FROM pg_constraint c
        JOIN unnest(c.conkey) k(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND c.confrelid IN ('locations'::regclass,'zones'::regclass,'reported_tags'::regclass,
                             'workers'::regclass,'operators'::regclass)
    ) s WHERE child <> ALL (string_to_array('$KNOWN_CHILDREN', ' '))")
  if [ -n "$unknown" ]; then
    bad "the schema has grown children this cleanup has never heard of: $unknown"
    rc=1
  else
    ok "every foreign key into workers/operators/locations/zones/reported_tags is one this cleanup handles"
  fi

  psql_box "
    BEGIN;
    DELETE FROM shifts WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%')
                          OR location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM material_requests WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM worker_sessions   WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%');
    DELETE FROM operator_sessions WHERE operator_id IN (SELECT id FROM operators WHERE name LIKE '${MARK}%');
    DELETE FROM phone_identities  WHERE worker_id IN (SELECT id FROM workers WHERE name LIKE '${MARK}%')
                                     OR operator_id IN (SELECT id FROM operators WHERE name LIKE '${MARK}%');
    DELETE FROM tag_aliases WHERE zone_id IN (SELECT id FROM zones WHERE name LIKE '${MARK}%'
                                                 OR location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%'));
    DELETE FROM zones WHERE name LIKE '${MARK}%'
                         OR location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM reported_tags WHERE reported_by_operator_id IN (SELECT id FROM operators WHERE name LIKE '${MARK}%')
                                 OR id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM location_contracts WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM location_revenue   WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM material_requests  WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM portal_grants      WHERE location_id IN (SELECT id FROM locations WHERE slug LIKE 'prove-delete-me-%');
    DELETE FROM locations WHERE slug LIKE 'prove-delete-me-%';
    DELETE FROM workers   WHERE name LIKE '${MARK}%';
    DELETE FROM operators WHERE name LIKE '${MARK}%';
    COMMIT;" >/dev/null || { echo "  FAIL: cleanup TRANSACTION FAILED — rows may survive" >&2; rc=1; FAILED=1; }

  # THE MAP, AFTER THE DELETES AND BEFORE THE ADMIN GOES. This is the closing claim of the
  # whole run — "HOIV present with its pin, no test buildings" — and it is the one claim a
  # row count cannot make: the pin is drawn by the director's browser from a Maps browser
  # key that is REFERRER-LOCKED to this host, so it can only be seen from here. The
  # screenshot has to happen while the throwaway session still exists, hence the ordering.
  if [ -f "$ADMIN_JAR" ]; then
    # THE MAP IS SAMPLED, NOT OBSERVED ONCE, AND THAT IS THE FINDING.
    #
    # "Karte wird geladen" is de.json's `home.mapLoading`; waiting for it to GO is what turns
    # this from a race into a measurement — the first version fired the moment the building
    # list appeared and called the map fine seconds before Google rejected the key.
    #
    # But a SETTLED single sample is still not the answer, because the answer is not stable:
    # an identical page load, same host, same key, same minute, comes back drawn about two
    # times in three and `RefererNotAllowedMapError` the rest. An unauthorised key would fail
    # every time; a key that is authorised and works would fail none. So both directions are
    # asserted and the ratio is printed:
    #
    # ONLY ONE ARM IS AN ASSERTION, and that is deliberate. `drawn == 0` means the referrer
    # is genuinely not on the key, and it goes RED — revoke it in the Cloud Console and this
    # run fails, which is a negative case that can actually happen. "It must NOT draw every
    # time" was the other arm for about an hour, and it is not an assertion: at roughly two
    # draws in three, five clean loads in a row come up about one run in eight. A check that
    # fails one run in eight teaches people to re-run it, which is worse than not having it.
    # The blocked count is therefore REPORTED, with its sample size, and the finding lives in
    # CORE-FLOW § 5 where a human can act on it.
    #
    # An unauthorised key does not fail the script LOAD, which is why the console is read
    # rather than the network: Google serves the file, `new Map()` succeeds, and what renders
    # is a grey box indistinguishable from "still loading" (web/lib/map.ts says exactly this).
    # Set and unset around the loop rather than as an assignment prefix: `VAR=1 func` is
    # restored afterwards in bash, but PERSISTS in POSIX mode, and this file is routinely
    # invoked as `sh ops/prove-live.sh` (/bin/sh on macOS is bash in POSIX mode).
    local samples="${MAP_SAMPLES:-5}" drawn=0 blocked=0 i
    SHOT_SAMPLING=1
    for i in $(seq 1 "$samples"); do
      shot "/" "05-map-$i.png" "HOIV" "Karte wird geladen" >/dev/null 2>&1 || true
      if /usr/bin/grep -q 'Auf der Karte:' "$SHOTS/05-map-$i.txt" 2>/dev/null; then
        drawn=$((drawn + 1)); cp "$SHOTS/05-map-$i.png" "$SHOTS/05-map-drawn.png"; cp "$SHOTS/05-map-$i.txt" "$SHOTS/05-map-drawn.txt"
      elif /usr/bin/grep -q 'RefererNotAllowedMapError' "$SHOTS/05-map-$i.console.txt" 2>/dev/null; then
        blocked=$((blocked + 1)); cp "$SHOTS/05-map-$i.png" "$SHOTS/05-map-blocked.png"; cp "$SHOTS/05-map-$i.console.txt" "$SHOTS/05-map-blocked.console.txt"
      fi
      rm -f "$SHOTS/05-map-$i.png" "$SHOTS/05-map-$i.txt" "$SHOTS/05-map-$i.console.txt"
    done
    SHOT_SAMPLING=0

    if [ -f "$SHOTS/05-map-drawn.txt" ]; then
      /usr/bin/grep -q "$MARK" "$SHOTS/05-map-drawn.txt" \
        && bad "the director's home screen still shows this run's test data" \
        || ok "the home screen lists HOIV and nothing this run created"
      /usr/bin/grep -q 'Auf der Karte: 1\. Ohne Koordinaten: 0\.' "$SHOTS/05-map-drawn.txt" \
        && ok "one building on the map, none without coordinates — HOIV has its pin" \
        || bad "the map's own count is '$(/usr/bin/grep -o 'Auf der Karte:.*' "$SHOTS/05-map-drawn.txt" | head -1)'"
    fi

    if [ "$drawn" -eq 0 ]; then
      bad "the map NEVER drew in $samples loads — the browser key is not authorised for $BASE (TASK-206)"
      rc=1
    else
      ok "the map drew $drawn/$samples — the key IS authorised for this host"
      [ "$blocked" -gt 0 ] && printf '  note: %s\n' \
        "$blocked of $samples identical loads came back RefererNotAllowedMapError for $BASE/ . Measured through headless Chrome with a cold profile; whether a warm human browser sees the same is UNPROVEN. TASK-206."
    fi
  fi

  local gone
  gone=$(ssh "$HOST" "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs delete $ADMIN_EMAIL'" 2>&1 | tail -1)
  [ "$gone" = "deleted 1" ] && ok "the throwaway admin is gone ($gone)" || bad "throwaway admin: $gone"

  # Not "the deletes ran" — "nothing is left", counted from the database afterwards.
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
    *) bad "production is NOT as it was found — see the counts above"; rc=1 ;;
  esac

  local hoiv
  hoiv=$(psql_box "SELECT slug || '|' || active || '|' || coalesce(lat::text,'NULL') || '|' || coalesce(lng::text,'NULL') FROM locations")
  [ "$hoiv" = "$BASELINE_HOIV" ] \
    && ok "HOIV is the row this run started with: $hoiv" \
    || { bad "HOIV row changed: '$hoiv' was '$BASELINE_HOIV'"; rc=1; }

  # The APK on the box is not this test's to touch, and a cleanup that quietly broke the
  # self-update it just proved would be the worst possible outcome of running it.
  local apk
  apk=$(ssh "$HOST" "sha256sum /srv/nfc/releases/*.apk | cut -d' ' -f1")
  [ "$apk" = "$BASELINE_APK" ] && ok "the published APK is untouched ($apk)" || bad "published APK changed"

  rm -rf "$TMP"
  if [ "$COMPLETED" -ne 1 ]; then
    echo
    echo "PROVE-LIVE DID NOT FINISH — it stopped early (rc=$rc). Production was cleaned, but"
    echo "                           every section after the last one printed above is UNPROVEN."
    exit 1
  fi
  if [ "$FAILED" -ne 0 ]; then echo; echo "PROVE-LIVE FAILED"; exit 1; fi
  echo; echo "PROVE-LIVE OK — $BASE"
  exit "$rc"
}

# ---- tiny HTTP helpers, same shape as ops/smoke-live.sh ----------------------------------
req() {
  local method="$1" path="$2"; shift 2
  local args=(-sS --max-time 40 -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path")
  while [ $# -gt 0 ]; do
    case "$1" in
      --jar)  args+=(-b "$2" -c "$2"); shift 2 ;;
      --key)  args+=(-H "X-App-Key: $APP_KEY"); shift ;;
      --data) args+=(-H "Content-Type: application/json" --data "$2"); shift 2 ;;
    esac
  done
  curl "${args[@]}"
}
body() { cat "$TMP/body"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v;try{v=JSON.parse(s)}catch{v={}};for(const k of process.argv[1].split("."))v=v?.[k];process.stdout.write(String(v??""))})' "$1" < "$TMP/body"; }
json() { node -e 'process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))' "$1"; }
now()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
# A SHIFT WITH ZERO DURATION IS REFUSED (`end_before_start`), and rightly — so the tap that
# opens one is stamped in the past, the way a real morning is. Two calls to now() land in
# the same second often enough that using it for both ends is a flaky test, not a real one.
ago()  { date -u -v-"$1"M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
uuid() { node -e 'process.stdout.write(require("node:crypto").randomUUID())'; }

# A ROW, PRINTED AS EVIDENCE — and an EMPTY result is a failure, not a blank line. Printing
# whatever psql returned is how "ok: row:" came to be logged for a shift that did not exist.
row() {
  local label="$1" sql="$2"
  local out; out=$(psql_box "$sql")
  [ -n "$out" ] && printf '  row:  %s: %s\n' "$label" "$out" || bad "$label: the database returned NO ROW"
}

expect() {
  local want="$1" method="$2" path="$3"; shift 3
  local got; got=$(req "$method" "$path" "$@")
  if [ "$got" = "$want" ]; then ok "$method $path -> $got"
  else bad "$method $path -> $got (want $want)  body: $(body | cut -c1-200)"; fi
}

# THE ACCESS LOG, read off the box. `--since @<epoch>` so nothing depends on agreeing with
# the VM about a timezone. An empty match is a FAILURE, not a shrug: it means the answer
# above came from something other than this process — a cache, a proxy, an old build.
logline() {
  local pattern="$1" label="${2:-$1}"
  local hit
  hit=$(ssh "$HOST" "sudo journalctl -u nfc-api --since '@$SINCE' --no-pager -o cat" 2>/dev/null \
          | /usr/bin/grep -E "$pattern" | tail -1)
  if [ -n "$hit" ]; then printf '  log:  %s\n' "$hit"
  else bad "nothing in the access log matched: $label"; fi
}

# A screenshot of the LIVE admin, logged in with the throwaway session. Never fatal on its
# own — a missing Chrome must not turn a production proof into a red — but a screenshot that
# rendered the WRONG THING is, because that is the failure it exists to catch.
#
# SHOT_SAMPLING=1 TURNS THE FAILURE ARM OFF, and it exists because of a real silent red. The
# map block below calls this five times with `>/dev/null 2>&1`, deliberately expecting some
# loads to fail. `bad` sets the GLOBAL failure flag but prints to stdout - so a swallowed
# sample set FAILED=1 with its message thrown away, and the run ended "PROVE-LIVE FAILED"
# with not one FAIL line anywhere in the transcript. Unactionable, and it made the previous
# green a coin toss (5/5 drawn) rather than a pass. A sampled probe returns non-zero and says
# nothing; only a call that is an ASSERTION is allowed to set the flag.
shot() {
  local page="$1" file="$2" wait_for="$3" wait_gone="${4:-}"
  local token
  token=$(/usr/bin/grep -E '\bts_session\b' "$ADMIN_JAR" | awk '{print $NF}')
  [ -n "$token" ] || { [ "${SHOT_SAMPLING:-0}" = "1" ] && return 1; bad "no ts_session cookie to screenshot with"; return 1; }
  mkdir -p "$SHOTS"
  local extra=()
  [ -n "$wait_gone" ] && extra=(--wait-gone "$wait_gone")
  # `${extra[@]+"${extra[@]}"}`, never a bare `"${extra[@]}"`. Under `set -u` in bash 3.2 -
  # which is what /bin/sh is on macOS, and how this file gets invoked as `sh ops/prove-live.sh`
  # - expanding an EMPTY array is an unbound-variable error. It killed the run dead at the
  # first screenshot that had no --wait-gone (§ 4, /tags/), and because the trap ran and every
  # assertion so far had passed, the transcript ended "PROVE-LIVE OK" having never executed
  # §§ 5-10. That second half is the reason COMPLETED exists below.
  if node ops/screenshot.mjs "$BASE$page" "$SHOTS/$file" --cookie "ts_session=$token" \
        --wait-text "$wait_for" ${extra[@]+"${extra[@]}"} --height 1400 >/dev/null 2>"$TMP/shot.err"; then
    ok "screen: $page rendered '$wait_for' -> docs/media/prove-live/$file"
  else
    [ "${SHOT_SAMPLING:-0}" = "1" ] && return 1
    bad "screen: $page never rendered '$wait_for' — $(tail -2 "$TMP/shot.err" | tr '\n' ' ')"
    return 1
  fi
}

echo "proving $BASE end to end   (marker: $MARK, slug: $PROVE_SLUG)"

# =========================================================================================
section "0 · the box, before anything"
SINCE=$(ssh "$HOST" 'date +%s')
# DERIVED FROM THE TREE, NEVER TYPED. This line read `= "8"` and stayed at 8 while 009 and
# 010 landed on the box, so the FIRST thing a production proof did was fail - for the box
# being CORRECT. A literal here does not check the box against anything; it checks it against
# whoever last remembered to edit this line. Counting server/db/migrations/*.sql asks the
# question that is actually worth asking: has the box run every migration THIS TREE HAS?
WANT_MIGRATIONS=$(/bin/ls server/db/migrations/*.sql | wc -l | tr -d ' ')
MIGRATIONS=$(psql_box "SELECT count(*) FROM schema_migrations")
[ "$MIGRATIONS" = "$WANT_MIGRATIONS" ] \
  && ok "$MIGRATIONS migrations applied - every .sql file in this tree is on the box" \
  || bad "$MIGRATIONS migrations on the box, $WANT_MIGRATIONS in server/db/migrations/ - deploy first"
BASELINE_HOIV=$(psql_box "SELECT slug || '|' || active || '|' || coalesce(lat::text,'NULL') || '|' || coalesce(lng::text,'NULL') FROM locations")
BASELINE_APK=$(ssh "$HOST" "sha256sum /srv/nfc/releases/*.apk | cut -d' ' -f1")
ok "the building on the wall: $BASELINE_HOIV"

# THE UUID THE CLEANERS ACTUALLY TAP. Everything below that says "the live card" means this.
WALL_ID=$(psql_box "SELECT id FROM locations WHERE slug NOT LIKE 'prove-delete-me-%'")
case "$WALL_ID" in
  *-*-*-*-*) ok "the live building id is $WALL_ID" ;;
  *) bad "could not read a single live building id (got '$WALL_ID')"; exit 1 ;;
esac

# A run that starts on a dirty box cannot make the closing claim, so it does not start.
# ADMINS ARE IN THIS COUNT, and they were not at first. A leftover throwaway admin from an
# earlier debugging session survived into a run, and the only thing that noticed was the
# CLOSING count — which reported "production is NOT as it was found" and blamed this run for
# a row it never created. A start guard that does not cover a table the end guard covers just
# moves the failure to the wrong place.
START_COUNTS=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM operators) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM zones) || '/' || (SELECT count(*) FROM reported_tags) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
[ "$START_COUNTS" = "0/0/0/0/0/1/1" ] \
  && ok "starting from a clean box (workers/operators/shifts/zones/reported_tags/locations/admins = $START_COUNTS)" \
  || { bad "the box is NOT clean at the start: $START_COUNTS — refusing to run, because the closing count would be a lie"; exit 1; }

trap cleanup EXIT

# =========================================================================================
section "1 · the phone — the operator writes two cards, NFC mocked"
# android/checks/live-flow.sh runs the REAL nfc/TagWriter against fake cards AND replays the
# debug simulator (the emulator's stand-in for a card) through it, so a mock that has drifted
# from the shipping build is caught here rather than in a stairwell. It is handed the uuid
# just read off the live database.
if (cd android && LIVE_HOIV_ID="$WALL_ID" ./checks/live-flow.sh "$PHONE" > "$TMP/phone.log" 2>&1); then
  ok "the phone half ran green ($(/usr/bin/grep -c '  ok:' "$TMP/phone.log") assertions)"
else
  bad "the phone half FAILED — transcript follows"
  cat "$TMP/phone.log"
  exit 1
fi
fact() { /usr/bin/awk -F'\t' -v k="$1" '$1==k{print $2}' "$PHONE/facts.tsv"; }

TAG_BUILDING=$(fact tag_building)
TAG_ZONE=$(fact tag_zone)
[ -n "$TAG_BUILDING" ] && [ -n "$TAG_ZONE" ] && ok "two cards written: $TAG_BUILDING / $TAG_ZONE" \
  || { bad "the phone did not emit two written tag ids"; exit 1; }
echo "  screen (Karte 1):"; /usr/bin/sed 's/^/    | /' "$PHONE/screen-write-building.txt"; echo

# =========================================================================================
section "2 · the guard, against the row the cleaners tap"
# Proven in full by the phone half; re-stated here because it is the claim, and because the
# token has to be the last six of the LIVE id and not of a constant in a source file.
GUARD_TOKEN=$(fact guard_token)
[ "$GUARD_TOKEN" = "$(node -e 'process.stdout.write(process.argv[1].slice(-6).toLowerCase())' "$WALL_ID")" ] \
  && ok "the override token is the last six of the LIVE building id ($GUARD_TOKEN)" \
  || bad "token '$GUARD_TOKEN' is not the last six of $WALL_ID"
/usr/bin/grep -q "$WALL_ID" "$PHONE/screen-guard-refused.txt" \
  && ok "the refusal screen names the live building id" || bad "the refusal screen does not name it"
echo "  screen (montierte Karte):"; /usr/bin/sed 's/^/    | /' "$PHONE/screen-guard-refused.txt"; echo

# =========================================================================================
section "3 · the office is told — POST /operator/tags, twice for one card"
expect 401 POST /operator/tags --key --data "{\"id\":\"$TAG_BUILDING\"}"
ok "…and a phone with no operator session cannot report at all"

CREATED=$(printf '%s' "$ADMIN_PASSWORD" | ssh "$HOST" \
  "sudo bash -c 'set -a; . /etc/nfc/env; set +a; node /srv/nfc/ops/smoke-admin.mjs create $ADMIN_EMAIL'" 2>&1 | tail -1)
case "$CREATED" in created\ *) ok "throwaway admin $CREATED" ;; *) bad "could not create the throwaway admin: $CREATED"; exit 1 ;; esac
expect 200 POST /admin/login --jar "$ADMIN_JAR" \
  --data "$(node -e 'process.stdout.write(JSON.stringify({email:process.argv[1],password:process.argv[2]}))' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
# THE LOGIN, not the run. This line used to read `[ "$FAILED" = "0" ]` - the GLOBAL failure
# flag - so any earlier red anywhere in the file aborted here printing "admin login failed",
# and the transcript blamed a login that had just answered 200. A guard must test the thing
# it names. Everything below needs a ts_session cookie and nothing else, so that is what is
# tested: no cookie, no point continuing.
/usr/bin/grep -q ts_session "$ADMIN_JAR" \
  || { bad "POST /admin/login answered but left no ts_session cookie - nothing below can run"; exit 1; }

expect 201 POST /admin/operators --jar "$ADMIN_JAR" --data "{\"name\":\"$MARK operator\",\"phone\":\"+436811111111\"}"
OPERATOR_ID=$(jget operator.id)
expect 201 POST "/admin/operators/$OPERATOR_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}'
OP_CODE=$(jget code)
expect 200 POST /auth/operator-code --key --jar "$OP_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$OP_CODE")"
/usr/bin/grep -q ts_operator "$OP_JAR" && ok "the phone now holds an operator session" || bad "no ts_operator cookie"

expect 201 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$TAG_BUILDING\"}"
expect 201 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$TAG_ZONE\"}"
logline "POST /operator/tags 201" "the 201s for the two reports"

# THE SAME PHYSICAL CARD, REPORTED TWICE. The operator taps `Meldung erneut senden`, or the
# app retries after a dropped connection: one row, answered 200, never a second tag.
expect 200 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$TAG_BUILDING\"}"
ROWS=$(psql_box "SELECT count(*) FROM reported_tags WHERE id = '$TAG_BUILDING'")
[ "$ROWS" = "1" ] && ok "two reports of one card, one row" || bad "reported_tags rows for that card: $ROWS"
logline "POST /operator/tags 200" "the idempotent second report"

UNBOUND=$(psql_box "SELECT count(*) FROM reported_tags WHERE id IN ('$TAG_BUILDING','$TAG_ZONE') AND resolved_at IS NULL AND reported_by_operator_id = $OPERATOR_ID")
[ "$UNBOUND" = "2" ] && ok "both rows are UNBOUND and carry the operator who reported them" || bad "unbound rows: $UNBOUND (want 2)"
row "the unbound tag" "SELECT id || ' reported_at=' || reported_at || ' resolved_at=' || coalesce(resolved_at::text,'NULL') FROM reported_tags WHERE id = '$TAG_BUILDING'"

# =========================================================================================
section "4 · it appears in the admin — the payload AND the screen"
expect 200 GET /admin/data --jar "$ADMIN_JAR"
IN_PAYLOAD=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);const ids=(d.reported_tags||[]).map(t=>t.id);process.stdout.write(String(process.argv.slice(1).every(i=>ids.includes(i))))})' "$TAG_BUILDING" "$TAG_ZONE" < "$TMP/body")
[ "$IN_PAYLOAD" = "true" ] && ok "both cards are in GET /admin/data reported_tags" || bad "the admin payload does not carry both cards"
NAMED=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=(JSON.parse(s).reported_tags||[]).find(t=>t.id===process.argv[1]);process.stdout.write(String(t?.reported_by_operator_name??""))})' "$TAG_BUILDING" < "$TMP/body")
[ "$NAMED" = "$MARK operator" ] && ok "the panel says who reported it: $NAMED" || bad "reported_by_operator_name = '$NAMED'"

# THE SCREEN ITSELF. Headless Chrome against the live host, with the throwaway admin's
# cookie, waiting for the tag id to actually be in the rendered text.
shot "/tags/" "01-tags-unbound.png" "$TAG_BUILDING"

# =========================================================================================
section "5 · the admin decides what the cards ARE — a TAG-FREE building, and two zones in it"
# decision-47 — MINTING A NEW BUILDING-LEVEL TAG IS RETIRED. A card can no longer become a
# building's own tap surface. The building is created TAG-FREE (its id comes from the
# DATABASE, never from a card), and the reported cards become ZONES in it.
expect 404 POST "/admin/tags/$TAG_BUILDING/resolve-building" --jar "$ADMIN_JAR" \
  --data "{\"name\":\"$MARK Haus\",\"slug\":\"$PROVE_SLUG\"}"
[ "$(jget error)" = "not_found" ] \
  && ok "POST /admin/tags/:id/resolve-building is GONE — the ROUTER answers, no handler exists" \
  || bad "resolve-building answered '$(jget error)' — it must not exist at all"

expect 201 POST /admin/locations --jar "$ADMIN_JAR" \
  --data "{\"slug\":\"$PROVE_SLUG\",\"name\":\"$MARK Haus\",\"address\":\"Arsenalstrasse 11, 1030 Wien\",\"lat\":48.1761151,\"lng\":16.3953038}"
NEW_LOCATION=$(jget location.id)
[ -n "$NEW_LOCATION" ] && [ "$NEW_LOCATION" != "$TAG_BUILDING" ] \
  && ok "the building's id came from the DATABASE ($NEW_LOCATION) and is not any card's" \
  || bad "the new building's id is '$NEW_LOCATION' — a caller must never choose it"

# The card that used to become a BUILDING becomes that building's FIRST ZONE instead. Same
# physical bytes, same id, never rewritten (decision-21/44).
expect 201 POST "/admin/tags/$TAG_BUILDING/resolve-zone" --jar "$ADMIN_JAR" \
  --data "{\"location_id\":\"$NEW_LOCATION\",\"name\":\"$MARK Erste Zone\"}"
FIRST_ZONE=$(jget zone.id)
[ "$FIRST_ZONE" = "$TAG_BUILDING" ] \
  && ok "the first zone IS the card — the bytes on it never change" \
  || bad "first zone id $FIRST_ZONE != card $TAG_BUILDING"
logline "POST /admin/tags/$TAG_BUILDING/resolve-zone 201"

expect 201 POST "/admin/tags/$TAG_ZONE/resolve-zone" --jar "$ADMIN_JAR" \
  --data "{\"location_id\":\"$NEW_LOCATION\",\"name\":\"$MARK Stiege A\",\"area_sqm\":120}"
NEW_ZONE=$(jget zone.id)
[ "$NEW_ZONE" = "$TAG_ZONE" ] && ok "the zone IS the second card ($NEW_ZONE)" || bad "zone id $NEW_ZONE != card $TAG_ZONE"

# Resolved once, and only once: a second admin clicking the same row is refused, not
# silently given a second zone.
expect 409 POST "/admin/tags/$TAG_ZONE/resolve-zone" --jar "$ADMIN_JAR" \
  --data "{\"location_id\":\"$NEW_LOCATION\",\"name\":\"$MARK Stiege A zweiter Versuch\"}"
LEFT=$(psql_box "SELECT count(*) FROM reported_tags WHERE resolved_at IS NULL")
[ "$LEFT" = "0" ] && ok "the admin's worklist is empty again — both cards resolved" || bad "$LEFT tags still unresolved"
row "the new zone" "SELECT l.slug || ' | zone ' || z.name || ' | ' || coalesce(z.area_sqm::text,'-') || ' m2 | tag_deployed_at=' || coalesce(z.tag_deployed_at::text,'NULL') || ' | verified_at=' || coalesce(z.verified_at::text,'NULL') FROM zones z JOIN locations l ON l.id = z.location_id WHERE z.id = '$NEW_ZONE'"
shot "/locations/" "02-building-created.png" "$MARK Haus"

# =========================================================================================
section "5b · the zone is NOT live until an operator test-scans the card (decision-47)"
# A zone an admin typed at a desk has proved NOTHING about a card on a wall. Until an
# operator, in the building, with the card in hand, has scanned it, a tap is refused BY NAME
# and NO shift row is created — which matters because shifts are never deleted. That refusal
# is asserted in § 6, with a real worker session and against the zone left UNVERIFIED here.
#
# THE TEST SCAN itself, on the OPERATOR's session. It cannot open a shift: no shift route
# accepts a ts_operator cookie, so this is structural rather than a rule a handler remembers.
expect 200 GET /operator/zones --key --jar "$OP_JAR"
ON_WORKLIST=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const z=(JSON.parse(s).zones||[]).find(z=>z.id===process.argv[1]);process.stdout.write(String(z?.verified_at===null))})' "$TAG_ZONE" < "$TMP/body")
[ "$ON_WORKLIST" = "true" ] && ok "the unverified zone is on the operator's worklist" || bad "the zone is not on the worklist as unverified"

SHIFTS_BEFORE_VERIFY=$(psql_box "SELECT count(*) FROM shifts")
expect 200 POST "/operator/zones/$TAG_ZONE/verify" --key --jar "$OP_JAR" --data "{\"place_uuid\":\"$TAG_ZONE\"}"
[ "$(jget zone.already_verified)" = "false" ] && ok "the test scan stamped it" || bad "already_verified=$(jget zone.already_verified) on the first scan"
SHIFTS_AFTER_VERIFY=$(psql_box "SELECT count(*) FROM shifts")
[ "$SHIFTS_BEFORE_VERIFY" = "$SHIFTS_AFTER_VERIFY" ] \
  && ok "A TEST SCAN CREATED NO SHIFT ($SHIFTS_BEFORE_VERIFY = $SHIFTS_AFTER_VERIFY) — the whole reason it is not a tap" \
  || bad "the shift count moved $SHIFTS_BEFORE_VERIFY -> $SHIFTS_AFTER_VERIFY during a TEST SCAN"

# A card that names the OTHER zone must not verify this one — a card mounted at the wrong
# door is the most likely honest mistake on a field visit.
expect 422 POST "/operator/zones/$TAG_ZONE/verify" --key --jar "$OP_JAR" --data "{\"place_uuid\":\"$TAG_BUILDING\"}"
[ "$(jget error)" = "zone_mismatch" ] && ok "a card from another door is refused: zone_mismatch" || bad "refused as '$(jget error)'"

# Idempotent: a second scan of an already-verified zone is a harmless 200 that moves nothing.
STAMP_BEFORE=$(psql_box "SELECT verified_at FROM zones WHERE id = '$TAG_ZONE'")
expect 200 POST "/operator/zones/$TAG_ZONE/verify" --key --jar "$OP_JAR" --data "{\"place_uuid\":\"$TAG_ZONE\"}"
[ "$(jget zone.already_verified)" = "true" ] && ok "a re-scan says so instead of erroring" || bad "a re-scan answered already_verified=$(jget zone.already_verified)"
STAMP_AFTER=$(psql_box "SELECT verified_at FROM zones WHERE id = '$TAG_ZONE'")
[ "$STAMP_BEFORE" = "$STAMP_AFTER" ] && ok "…and the timestamp did not move" || bad "verified_at moved: $STAMP_BEFORE -> $STAMP_AFTER"
row "the verified zone" "SELECT z.name || ' | verified_at=' || coalesce(z.verified_at::text,'NULL') || ' | by ' || coalesce(o.name,'NULL') FROM zones z LEFT JOIN operators o ON o.id = z.verified_by_operator_id WHERE z.id = '$TAG_ZONE'"

# =========================================================================================
section "6 · a cleaner taps — the card opens a shift, and a second tap closes it"
expect 201 POST /admin/workers --jar "$ADMIN_JAR" --data "{\"name\":\"$MARK worker\",\"hourly_rate_cents\":1450,\"active\":true}"
WORKER_ID=$(jget worker.id)
expect 201 POST "/admin/workers/$WORKER_ID/enrolment-code" --jar "$ADMIN_JAR" --data '{}'
W_CODE=$(jget code)
expect 200 POST /auth/code --key --jar "$WORKER_JAR" --data "$(node -e 'process.stdout.write(JSON.stringify({code:process.argv[1]}))' "$W_CODE")"
/usr/bin/grep -q ts_worker "$WORKER_JAR" && ok "the cleaner's phone holds a worker session" || bad "no ts_worker cookie"

# THE UNVERIFIED DOOR FIRST (decision-47). $TAG_BUILDING is a real, ACTIVE zone of this same
# building that no operator has test-scanned. A tap on it is refused BY NAME and, the part
# that actually costs money if it is wrong, WRITES NO SHIFT ROW — there is no
# DELETE /admin/shifts/:id anywhere in this codebase.
UNVERIFIED_BEFORE=$(psql_box "SELECT count(*) FROM shifts")
expect 422 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$(uuid)\",\"location_uuid\":\"$TAG_BUILDING\",\"start_time\":\"$(now)\"}"
[ "$(jget error)" = "zone_unverified" ] \
  && ok "an unproven card is refused as zone_unverified — its own code, not 'this building was removed'" \
  || bad "refused as '$(jget error)'"
UNVERIFIED_AFTER=$(psql_box "SELECT count(*) FROM shifts")
[ "$UNVERIFIED_BEFORE" = "$UNVERIFIED_AFTER" ] \
  && ok "NO shift row was created ($UNVERIFIED_BEFORE = $UNVERIFIED_AFTER)" \
  || bad "the shift count moved $UNVERIFIED_BEFORE -> $UNVERIFIED_AFTER on a REFUSED tap"
logline "POST /shifts/open 422 .* err=zone_unverified" "the refusal, in the log"

# THE TAP. The body is the OLD SHAPE the APK in the field sends — client_uuid, location_uuid,
# start_time, and no zone field anywhere — posted at the VERIFIED ZONE card, which the server
# resolves to its building.
TAP1=$(uuid)
expect 201 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP1\",\"location_uuid\":\"$TAG_ZONE\",\"start_time\":\"$(ago 45)\"}"
SHIFT_ID=$(jget shift.id)
[ "$(jget shift.start_zone_id)" = "$TAG_ZONE" ] && ok "the shift carries the ZONE the cleaner tapped" || bad "start_zone_id = $(jget shift.start_zone_id)"
[ "$(jget shift.location_id)" = "$NEW_LOCATION" ] && ok "…and resolves to the building that zone is in" || bad "location_id = $(jget shift.location_id)"
logline "POST /shifts/open 201 .* w=$WORKER_ID" "the clock-in, w=$WORKER_ID"
row "the open shift" "SELECT id || ' | worker ' || worker_id || ' | zone ' || coalesce(start_zone_id::text,'NULL') || ' | end_time ' || coalesce(end_time::text,'OPEN') FROM shifts WHERE id = $SHIFT_ID"

# THE SECOND TAP. There is no in-app button that closes a shift — tapping the same card
# again is the only way out, and it is what the cleaner does at the door on the way home.
expect 200 POST /shifts/close --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP1\",\"location_uuid\":\"$TAG_ZONE\",\"end_time\":\"$(now)\"}"
CLOSED=$(psql_box "SELECT end_time IS NOT NULL FROM shifts WHERE id = $SHIFT_ID")
[ "$CLOSED" = "t" ] && ok "the second tap closed it" || bad "the shift is still open"

# AND A CLOCK-OUT IS NEVER GATED (INCIDENT 1). A worker who is clocked in must always be able
# to clock out, including through the unproven back door — the gate is on OPEN only.
TAP_OUT=$(uuid)
expect 201 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP_OUT\",\"location_uuid\":\"$TAG_ZONE\",\"start_time\":\"$(ago 10)\"}"
expect 200 POST /shifts/close --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP_OUT\",\"location_uuid\":\"$TAG_BUILDING\",\"end_time\":\"$(now)\"}"
# `auto_closed` through the `||` operator casts to 'true'/'false', NOT psql's bare-boolean
# 't'/'f' - the same trap ops/prove-zone-verification.sh's cleanup already records, and it
# made this line red against a shift row that was perfectly correct (the `row:` line below
# printed auto_closed=false in the same breath).
OUT_ZONE=$(psql_box "SELECT coalesce(end_zone_id::text,'NULL') || '|' || auto_closed FROM shifts WHERE client_uuid = '$TAP_OUT'")
[ "$OUT_ZONE" = "$TAG_BUILDING|false" ] \
  && ok "a clock-out through an UNVERIFIED door closes normally and records it — never gated" \
  || bad "the unverified clock-out recorded '$OUT_ZONE' (want $TAG_BUILDING|false)"
logline "POST /shifts/close 200 .* w=$WORKER_ID" "the clock-out"
row "the closed shift" "SELECT 'end_zone=' || coalesce(end_zone_id::text,'NULL') || ' auto_closed=' || auto_closed || ' minutes=' || round(extract(epoch from (end_time - start_time))/60) FROM shifts WHERE id = $SHIFT_ID"
shot "/shifts/" "03-shift-closed.png" "$MARK worker"

# =========================================================================================
section "7 · the OLD card on the wall still clocks in"
# Nothing in 006/007/008 may have changed what the card already screwed to the wall at HOIV
# does. Same old-shape body, the live building uuid, no zone: 201, and start_zone_id NULL
# because that building has no zones (decision-43 — grey, not dead).
TAP2=$(uuid)
WALL_START=$(ago 20)
expect 201 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP2\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$WALL_START\"}"
[ -z "$(jget shift.start_zone_id)" ] && ok "start_zone_id is NULL — an unzoned building invents no zone" || bad "start_zone_id=$(jget shift.start_zone_id)"
expect 200 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$TAP2\",\"location_uuid\":\"$WALL_ID\",\"start_time\":\"$WALL_START\"}"
COUNT=$(psql_box "SELECT count(*) FROM shifts WHERE client_uuid = '$TAP2'")
[ "$COUNT" = "1" ] && ok "one tap, one shift, even retried on flaky wifi" || bad "shifts for that tap: $COUNT"
expect 200 POST /shifts/close --key --jar "$WORKER_JAR" --data "{\"client_uuid\":\"$TAP2\",\"location_uuid\":\"$WALL_ID\",\"end_time\":\"$(now)\"}"
logline "POST /shifts/open 201 .* w=$WORKER_ID" "the wall tap"

# =========================================================================================
section "8 · a tap on an UNBOUND card is harmless, and says so in German"
ORPHAN=$(uuid)
expect 201 POST /operator/tags --key --jar "$OP_JAR" --data "{\"id\":\"$ORPHAN\"}"
BEFORE=$(psql_box "SELECT count(*) FROM shifts")
expect 422 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$(uuid)\",\"location_uuid\":\"$ORPHAN\",\"start_time\":\"$(now)\"}"
[ "$(jget error)" = "tag_unbound" ] && ok "refused as tag_unbound" || bad "refused as '$(jget error)'"
AFTER=$(psql_box "SELECT count(*) FROM shifts")
[ "$BEFORE" = "$AFTER" ] && ok "NO shift row was created ($BEFORE = $AFTER)" || bad "shift count moved $BEFORE -> $AFTER"
logline "POST /shifts/open 422 .* err=tag_unbound" "the refusal, in the log"
# The sentence the cleaner reads, rendered from res/values/strings.xml by the phone half.
UNBOUND_DE=$(fact unbound_de)
[ -n "$UNBOUND_DE" ] && ok "the phone says: „$UNBOUND_DE\"" || bad "no German sentence for an unbound tap"
case "$UNBOUND_DE" in *[Vv]erwaltung*) ok "…and it tells the cleaner what to DO about it" ;; *) bad "the sentence does not say who to tell" ;; esac
# A card nobody ever reported is refused the same way — the tag, not the report, is what
# fails to resolve, so an unreported uuid must not answer differently.
expect 422 POST /shifts/open --key --jar "$WORKER_JAR" \
  --data "{\"client_uuid\":\"$(uuid)\",\"location_uuid\":\"$(uuid)\",\"start_time\":\"$(now)\"}"
ok "a card the office has never heard of: $(jget error)"


# =========================================================================================
section "9 · the director's own screens, with this run's data on them"
RANGE="from=$(date -u -v-30d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT00:00:00Z)&to=$(date -u +%Y-%m-%dT23:59:59Z)"
expect 200 GET "/admin/analytics?$RANGE" --jar "$ADMIN_JAR"
# `location_id`, not `id` — lib/reporting.js names it that, and a lookup on the wrong key
# silently returns undefined for EVERY building, which reads as "missing" and not as a bug
# in the check.
building_field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s).buildings||[];const f=b.find(x=>x.location_id===process.argv[1]);if(!f){process.stdout.write("missing");return}process.stdout.write(process.argv.slice(2).map(k=>String(f[k])).join("/"))})' "$@" < "$TMP/body"; }
ZONED=$(building_field "$WALL_ID" zone_state active)
[ "$ZONED" = "unzoned/true" ] && ok "HOIV is still unzoned AND active on the director's dashboard (decision-43)" || bad "HOIV reads $ZONED"
NEWSTATE=$(building_field "$NEW_LOCATION" zone_state)
[ "$NEWSTATE" = "zoned" ] && ok "the building this run created reads 'zoned' — the two states are told apart" || bad "the new building reads '$NEWSTATE'"
shot "/analytics/" "04-analytics.png" "$MARK Haus"

# THE LAST EXECUTABLE LINE IN THE FILE. Anything that stops the script before here - a red
# assertion's `exit 1`, an unbound variable, a dropped ssh - leaves this at 0 and the trap
# refuses to print OK. It must stay last; a new section appended below it would be silently
# excluded from the very claim this flag exists to make.
COMPLETED=1
