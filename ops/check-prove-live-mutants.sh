#!/usr/bin/env bash
#
# EVERY NEW ASSERTION, SHOWN RED BEFORE IT IS BELIEVED.
#
#     ./ops/check-prove-live-mutants.sh [--only <substring>]
#
# WHY. This repo has shipped five checks that passed over zero rows, and one
# (release-artefact.sh) whose failing branch could not fail at all because `grep -q` took
# SIGPIPE under `pipefail`. A green transcript is evidence of nothing until the same
# transcript has been made to go red on purpose. So each mutant below breaks exactly one
# thing — in the SOURCE, or in the live DATABASE — runs the check that is supposed to notice,
# and requires it to fail. Then it restores, and the tree is compared against git.
#
# TWO KINDS OF MUTANT, and the second kind is the reason this file is in ops/ and not in
# android/checks/:
#
#   SOURCE mutants   patch a file, re-run android/checks/live-flow.sh, restore.
#   PRODUCTION seeds  change a row on the LIVE box (deactivate the building, resolve a tag
#                     that should be unbound, plant an unmarked row), re-run the part of
#                     ops/prove-live.sh that is supposed to care, then put the row back.
#                     A seed that only ever ran against a fixture would prove that the
#                     fixture is wired up, not that production is.
#
# EVERY SEED IS UNDONE IN A TRAP, and the last thing this script does is re-assert the same
# closing counts ops/prove-live.sh does.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

ONLY=""
[ "${1:-}" = "--only" ] && ONLY="${2:-}"

HOST="$(node -e 'process.stdout.write(require("./ops/branding.json").apiHost)')"
psql_box() { ssh "$HOST" "sudo -u postgres psql -d nfc -v ON_ERROR_STOP=1 -Atc \"$1\""; }

WALL_ID="$(psql_box "SELECT id FROM locations LIMIT 1")"
TMP="$(mktemp -d)"
FAILED=0
RUN=0

ok()  { printf '    ok:   %s\n' "$1"; }
bad() { printf '    FAIL: %s\n' "$1"; FAILED=1; }

# Restore anything a seed left behind, whatever happened.
restore_box() {
  psql_box "UPDATE locations SET active = TRUE WHERE id = '$WALL_ID';
            DELETE FROM workers WHERE name = 'MUTANT-DELETE-ME';" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap restore_box EXIT

skip() { [ -n "$ONLY" ] && [[ "$1" != *"$ONLY"* ]]; }

# --- SOURCE MUTANTS -----------------------------------------------------------------------
#
# $1 label   $2 file   $3 perl -pe expression   $4 the assertion text that must appear in the
# red transcript (so "it went red" is not satisfied by a compile error somewhere else).
source_mutant() {
  local label="$1" file="$2" expr="$3" needle="$4"
  skip "$label" && return
  RUN=$((RUN + 1))
  printf '\n  [%s] %s\n' "$RUN" "$label"
  cp "$file" "$TMP/orig"
  perl -0pi -e "$expr" "$file"
  if /usr/bin/git diff --quiet -- "$file"; then
    bad "the mutation changed NOTHING — the pattern no longer matches $file"
    cp "$TMP/orig" "$file"
    return
  fi
  local out="$TMP/red.log"
  if (cd android && LIVE_HOIV_ID="$WALL_ID" ./checks/live-flow.sh "$TMP/out" > "$out" 2>&1); then
    bad "RED expected, got GREEN — the assertion cannot fail"
  elif /usr/bin/grep -q "$needle" "$out"; then
    ok "RED: $(/usr/bin/grep -m1 "$needle" "$out" | /usr/bin/sed 's/^ *//')"
  else
    bad "it failed, but not on '$needle' — it may be failing for an unrelated reason"
    /usr/bin/grep -m3 'FAIL\|error:' "$out" | /usr/bin/sed 's/^/      /'
  fi
  # RESTORED TO WHAT IT WAS, not to what git has. Comparing against git makes every mutant
  # report RESTORE FAILED whenever the file under test has an unrelated uncommitted edit,
  # which is the normal state of a file somebody is working on.
  cp "$TMP/orig" "$file"
  cmp -s "$TMP/orig" "$file" && ok "restored" || bad "RESTORE FAILED — $file is not what it was"
}

# --- PRODUCTION SEEDS ---------------------------------------------------------------------
#
# $1 label   $2 sql to seed   $3 command that must FAIL   $4 needle in its output   $5 sql to undo
prod_seed() {
  local label="$1" seed="$2" cmd="$3" needle="$4" undo="$5"
  skip "$label" && return
  RUN=$((RUN + 1))
  printf '\n  [%s] %s\n' "$RUN" "$label"
  psql_box "$seed" >/dev/null || { bad "could not seed the box"; return; }
  local out="$TMP/red.log"
  if eval "$cmd" > "$out" 2>&1; then
    bad "RED expected, got GREEN — production disagreed with the seed"
  elif /usr/bin/grep -q "$needle" "$out"; then
    ok "RED: $(/usr/bin/grep -m1 "$needle" "$out" | /usr/bin/sed 's/^ *//' | cut -c1-150)"
  else
    bad "it failed, but not on '$needle'"
    /usr/bin/grep -m3 'FAIL' "$out" | /usr/bin/sed 's/^/      /'
  fi
  psql_box "$undo" >/dev/null && ok "the box is back" || bad "COULD NOT UNDO THE SEED"
}

echo "mutation-testing against $HOST   (the live building is $WALL_ID)"

# =========================================================================================
echo
echo "== A · the phone half (android/checks/live-flow-check.kt)"

# § 1. The mock claims its mounted card is the building in production. Hand the check a
# DIFFERENT live id and it must notice — which is the whole reason the id is not a constant.
if ! skip "wrong live id"; then
  RUN=$((RUN + 1))
  printf '\n  [%s] the check is handed a live id that is NOT the mock'\''s\n' "$RUN"
  if (cd android && LIVE_HOIV_ID="11111111-2222-4333-8444-555555555555" ./checks/live-flow.sh "$TMP/out" > "$TMP/red.log" 2>&1); then
    bad "RED expected, got GREEN — § 1 does not actually compare the two"
  else
    ok "RED: $(/usr/bin/grep -m1 'FAIL.*production holds' "$TMP/red.log" | /usr/bin/sed 's/^ *//')"
  fi
fi

# § 2. The debug mock stops asking the guard. It would then show a card being written that
# the shipping build refuses — the exact class of lie a mock can tell.
# Not deleted — NEUTERED, which is the mutation a careless edit would actually make: the
# guard is still called, still returns a verdict, and is simply handed a confirmation for
# whatever is on the card, so it proceeds every time. It compiles, which is the point.
source_mutant "the debug mock confirms every card for itself, so the guard never refuses" \
  android/app/src/debug/kotlin/io/github/qwadratic/nfctimesheets/nfc/WriteSimulation.kt \
  's/WriteGuard\.decide\(existing, write\.locationId, confirmedOverwriteOf\)/WriteGuard.decide(existing, write.locationId, (existing as? WriteGuard.Existing.Ours)?.locationId)/' \
  'MOUNTED'

# § 2 again, and this is the drift this check was written to catch: the mock compares raw
# bytes instead of parsing the read-back the way Ndef.getNdefMessage() does.
source_mutant "the debug mock stops parsing the read-back (the FormatException drift)" \
  android/app/src/debug/kotlin/io/github/qwadratic/nfctimesheets/nfc/WriteSimulation.kt \
  's/simulation\.corrupt\(write\.bytes\)\?\.let \{ NdefMessage\(it\)\.toByteArray\(\) \}/simulation.corrupt(write.bytes)/' \
  'truncated mid-write'

# § 4. The guard itself. Not "a comment says it is called" — delete its effect and nine
# assertions about the LIVE building must go red.
# The SHIPPING writer, neutered the same way the mock was: the guard is still called and
# still consulted, and is handed a confirmation for whatever the card happens to hold. This
# is TASK-220 exactly — and now it is asserted against the id the cleaners tap, not a
# constant that claims to be it.
source_mutant "TagWriter stops refusing a card that already holds one of our ids" \
  android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/TagWriter.kt \
  's/WriteGuard\.decide\(existing, write\.locationId, confirmedOverwriteOf\)/WriteGuard.decide(existing, write.locationId, (existing as? WriteGuard.Existing.Ours)?.locationId)/' \
  'presenting the live card gives'

# § 4c. The confirmation stops being specific — any six characters would do.
source_mutant "the override accepts anything typed into the box" \
  android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core/WriteGuard.kt \
  's/return entered == token\(id\) \|\| entered == id/return entered.isNotEmpty()/' \
  'confirm nothing'

# § 5. The capacity gate. The 46-byte Ultralight is the one refusal CORE-FLOW § 4 step 2
# exists to confirm on hardware; off hardware, this is what says the code refuses at all.
source_mutant "the capacity check is removed — the 46-byte Ultralight gets written" \
  android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core/NdefTag.kt \
  's/if \(capacity < bytes\.size\) return Plan\.TooSmall/if (false) return Plan.TooSmall/' \
  '46 bytes gives'

# § 6. The German renderer drifts from the Activity: a screen text this transcript prints
# would then be a sentence the phone no longer shows.
# `write_open` exists in strings.xml and is not on either of § 6's lists, so this is the
# real shape of the drift: a new outcome branch is written in the Activity, the transcript
# keeps printing the old sentence for it, and nothing says a word.
source_mutant "the Activity gains an outcome string the renderer does not know" \
  android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/WriteTagActivity.kt \
  's/is TagWriter\.Outcome\.Lost -> getString\(R\.string\.write_lost\)/is TagWriter.Outcome.Lost -> getString(R.string.write_open)/' \
  'FAIL: WriteTagActivity uses R.string.write_open'

# § 7. The German for a refused tap disappears. A cleaner would read a blank line.
source_mutant "the German sentence for a rejected tap is deleted" \
  android/app/src/main/res/values/strings.xml \
  's/<string name="err_rejected">/<string name="err_rejected_RENAMED">/' \
  'err_rejected'

# =========================================================================================
echo
echo "== B · the production half (ops/prove-live.sh), seeded on the LIVE box"

# THE WALL TAG. Deactivating the building is the one change that makes the card screwed to
# the wall stop working, and § 7's whole claim is that it still does.
prod_seed "the building on the wall is deactivated" \
  "UPDATE locations SET active = FALSE WHERE id = '$WALL_ID'" \
  "./ops/prove-live.sh" \
  "POST /shifts/open -> 422" \
  "UPDATE locations SET active = TRUE WHERE id = '$WALL_ID'"

# THE START GUARD. An unmarked row nobody deletes is exactly what the closing count exists
# to catch, and until this run it was only ever asserted over a box that was already clean.
prod_seed "an unmarked row is planted that no cleanup will remove" \
  "INSERT INTO workers (name, hourly_rate_cents, active) VALUES ('MUTANT-DELETE-ME', 1, FALSE)" \
  "./ops/prove-live.sh" \
  "the box is NOT clean at the start" \
  "DELETE FROM workers WHERE name = 'MUTANT-DELETE-ME'"

# =========================================================================================
echo
echo "== C · the production half, mutated in the SCRIPT"
#
# These four cannot be seeded in the database, because what they assert is not a row: that
# the answer came from THIS process (the access log), that the update is the build we
# published (the sha and the signature), and that a screenshot is of the thing it names.

script_mutant() {
  local label="$1" expr="$2" needle="$3"
  skip "$label" && return
  RUN=$((RUN + 1))
  printf '\n  [%s] %s\n' "$RUN" "$label"
  cp ops/prove-live.sh "$TMP/orig.sh"
  perl -0pi -e "$expr" ops/prove-live.sh
  if /usr/bin/git diff --quiet -- ops/prove-live.sh; then
    bad "the mutation changed NOTHING"; cp "$TMP/orig.sh" ops/prove-live.sh; return
  fi
  if ./ops/prove-live.sh > "$TMP/red.log" 2>&1; then
    bad "RED expected, got GREEN"
  elif /usr/bin/grep -q "$needle" "$TMP/red.log"; then
    ok "RED: $(/usr/bin/grep -m1 "$needle" "$TMP/red.log" | /usr/bin/sed 's/^ *//' | cut -c1-160)"
  else
    bad "it failed, but not on '$needle'"; /usr/bin/grep -m3 'FAIL' "$TMP/red.log" | /usr/bin/sed 's/^/      /'
  fi
  cp "$TMP/orig.sh" ops/prove-live.sh
  chmod +x ops/prove-live.sh
  cmp -s "$TMP/orig.sh" ops/prove-live.sh && ok "restored" || bad "RESTORE FAILED"
}

# THE ACCESS LOG. `logline` reading an empty journal must be a failure, or every one of the
# eight "log:" lines in the transcript is decoration. Moving the window into the future is
# the honest way to empty it without touching the box.
# The window is pushed to the year 2286 rather than rewritten to another shell command:
# perl interpolates `$(` as its own variable and silently produced a corrupt line, which
# then failed for the wrong reason and still looked like a red.
script_mutant "the access-log window is moved past every request this run makes" \
  's/\nSINCE=[^\n]*\n/\nSINCE=9999999999\n/' \
  'nothing in the access log matched'

# THE PUBLISHED APK IS THE ONE WE BUILT. Point the comparison at a build signed by another
# hand and the same-signer assertion must fall over — this is the property that decides
# whether `adb install -r` lands or the OS refuses the update outright.
# EVERY `$` IS ESCAPED. perl interpolates its own variables in the replacement, so an
# unescaped $TMP becomes the empty string and the mutant then fails for the wrong reason —
# which still looks like a red, and is the way a mutation harness lies to you.
script_mutant "the 'field build' is swapped for one signed with a different key" \
  's{^FIELD_APK=android/dist/[^\n]*}{FIELD_APK="\$TMP/rogue-field.apk"\ncp android/dist/nfc-timesheets-0.4.0-5-release.apk "\$FIELD_APK"\nexport JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"\nexport PATH="\$JAVA_HOME/bin:\$PATH"\nkeytool -genkeypair -keystore "\$TMP/rk.jks" -storepass rogue123 -keypass rogue123 -alias r -keyalg RSA -keysize 2048 -validity 30 -dname "CN=Not Us" >/dev/null 2>\&1\n"\$(/bin/ls -d /opt/homebrew/share/android-commandlinetools/build-tools/*/apksigner | tail -1)" sign --ks "\$TMP/rk.jks" --ks-pass pass:rogue123 --key-pass pass:rogue123 --ks-key-alias r "\$FIELD_APK" >/dev/null 2>\&1}m' \
  'the update would be REFUSED by the OS'

# THE DOWNLOADED BYTES ARE THE PUBLISHED BYTES. UpdateManager refuses a truncated download
# that DownloadManager still calls successful; this is that check, from the outside.
script_mutant "one byte of the downloaded APK is flipped" \
  's{  GOT=\$\(shasum}{  printf x >> "\$TMP/update.apk"\n  GOT=\$(shasum}' \
  'downloaded sha'

# A SCREENSHOT OF THE WRONG THING. `shot` must fail when the page never renders what it
# names, or "it appears in the admin" is satisfied by any page at all.
script_mutant "the admin screenshot waits for text that is not on the page" \
  's/shot "\/tags\/" "01-tags-unbound\.png" "\$TAG_BUILDING"/shot "\/tags\/" "01-tags-unbound.png" "THIS-TEXT-IS-NOT-ON-THE-PAGE"/' \
  'never rendered'

# =========================================================================================
echo
echo "== D · the box, afterwards"
LEFT=$(psql_box "SELECT (SELECT count(*) FROM workers) || '/' || (SELECT count(*) FROM operators) || '/' || (SELECT count(*) FROM shifts) || '/' || (SELECT count(*) FROM zones) || '/' || (SELECT count(*) FROM reported_tags) || '/' || (SELECT count(*) FROM locations) || '/' || (SELECT count(*) FROM admins)")
[ "$LEFT" = "0/0/0/0/0/1/1" ] && ok "production is clean: $LEFT" || bad "production is NOT clean after the mutants: $LEFT"
ACTIVE=$(psql_box "SELECT active FROM locations WHERE id = '$WALL_ID'")
[ "$ACTIVE" = "t" ] && ok "the building on the wall is active again" || bad "the wall building is still deactivated"
# The SOURCE files only. docs/media/prove-live/ is regenerated by every run of
# ops/prove-live.sh and is expected to differ; a mutant that edited a .kt or a .sh and did
# not put it back is what this is looking for.
DIRTY=$(/usr/bin/git status --porcelain -- android server web ops '*.md' | /usr/bin/grep -v '^?? ' || true)
[ -z "$DIRTY" ] && ok "no source file was left mutated" || { bad "THE TREE IS DIRTY — a mutant was not restored"; echo "$DIRTY"; }

echo
if [ "$FAILED" -ne 0 ]; then echo "MUTANTS FAILED"; exit 1; fi
echo "MUTANTS OK — $RUN assertions shown RED, restored, and GREEN again"
