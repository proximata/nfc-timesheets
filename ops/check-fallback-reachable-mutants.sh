#!/bin/sh
# THE NEGATIVE CASES FOR ops/check-fallback-reachable.mjs.
#
#   sh ops/check-fallback-reachable-mutants.sh
#
# The check it guards asserts an ABSENCE — that nothing conditions the enrolment code on
# SMS. An absence assertion is the easiest kind to write wrongly: a typo in a name it greps
# for, a slice that lands on the wrong part of the file, and it passes for ever while
# proving nothing. So every one of its claims is broken here on purpose and watched to fail.
#
# Each mutant is a change somebody could make IN GOOD FAITH. That is the point: none of
# these would look like a regression in review, and all of them delete the owner's "always".
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

ADM="server/routes/admin.js"
AUT="server/routes/auth.js"
APP="server/routes/app.js"
PAGE="web/app/workers/page.tsx"
DE="web/messages/de.json"
# EVERY file any mutant touches must be in this list, or the trap leaves the tree dirty and
# the next run's baseline is a lie. Learned the hard way: app.js was mutated by §9 and not
# listed, and the "GREEN after revert" gate is what caught it.
FILES="$ADM $AUT $APP $PAGE $DE"

BACKUP=$(mktemp -d)
key() { echo "$1" | tr / _; }
trap 'for f in $FILES; do b="$BACKUP/$(key "$f")"; [ -f "$b" ] && cp "$b" "$f"; done; rm -rf "$BACKUP"' EXIT INT TERM
for f in $FILES; do cp "$f" "$BACKUP/$(key "$f")"; done
restore_all() { for f in $FILES; do cp "$BACKUP/$(key "$f")" "$f"; done; }

run_check() { node ops/check-fallback-reachable.mjs >/dev/null 2>&1; }

pass=0
fail=0

mutate() {
  name="$1"; file="$2"; from="$3"; to="$4"
  restore_all
  if ! /usr/bin/grep -qF -- "$from" "$file"; then
    echo "DEAD  $name — site not found in $file"
    fail=$((fail + 1))
    restore_all
    return
  fi
  FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if run_check; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
run_check && echo "GREEN baseline" || { echo "BASELINE IS RED — fix that first." >&2; exit 1; }

# =======================================================================================
# 1 · THE BUTTON IS HIDDEN WHEN SMS IS OFF. The single most likely well-meaning change in
#     this whole feature: "do not show a control that will not work". It deletes the
#     fallback for exactly the box that needs it — the one where SMS is not configured.
# =======================================================================================
mutate "the „Zugangscode erstellen\" button is wrapped in {smsConfigured && …}" \
  "$PAGE" \
  '                      {worker.active ? (' \
  '                      {worker.active && !smsConfigured ? (' \

# =======================================================================================
# 2 · THE BUTTON IS HIDDEN FOR A WORKER WHO HAS A LOGIN NUMBER. "They can get an SMS, so
#     they do not need a code" — until the SMS does not arrive.
# =======================================================================================
mutate "the button is hidden once the worker has a phone_identity" \
  "$PAGE" \
  '                      {worker.active ? (' \
  '                      {worker.active && !worker.phone_identity ? (' \

# =======================================================================================
# 3 · REVOKE IS DELETED FROM THE ROUTE TABLE. A code read out to the wrong person then has
#     no off switch for five days (decision-26: "a code read aloud over the phone to the
#     wrong person is the expected failure mode").
# =======================================================================================
mutate "DELETE /admin/workers/:id/enrolment-code is removed from the route table" \
  "$ADM" \
  '  { method: "DELETE", path: "/admin/workers/:id/enrolment-code", auth: "admin", handler: revokeEnrolmentCode },' \
  ''

# =======================================================================================
# 4 · THE WORKER'S DOOR IS DELETED. Every code already spoken over the telephone becomes
#     worthless in the same second.
# =======================================================================================
mutate "POST /auth/code is removed from the route table" \
  "$AUT" \
  '  { method: "POST", path: "/auth/code", auth: "app", handler: codeAuth },' \
  ''

# =======================================================================================
# 5 · THE FALLBACK MOVES BEHIND A PARAMETER. `POST .../enrolment-code {deliver:"sms"}`
#     looks tidier than two routes and is exactly how the code path becomes something a
#     caller has to remember to ask for.
# =======================================================================================
mutate "the mint route grows a delivery option" \
  "$ADM" \
  '  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  return {
    status: 201,' \
  '  if (body.deliver === "sms" && smsConfigured()) { /* … */ }
  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  return {
    status: 201,'

# =======================================================================================
# 6 · THE CODE IS BUILT AFTER THE SEND. A reordering that reads as a harmless tidy-up, and
#     that puts the entire fallback downstream of a network call.
# =======================================================================================
mutate "the SMS handler contacts Twilio BEFORE the code exists" \
  "$ADM" \
  '  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  const body = {' \
  '  const probe = await sendSms(worker.phone_e164, "probe");
  void probe;
  const minted = await mintEnrolmentCode(worker.id, session.adminId);
  const body = {'

# =======================================================================================
# 7 · A FAILED SEND BECOMES AN ERROR STATUS, so the panel's catch swallows the body.
# =======================================================================================
mutate "a failed send answers 502 instead of 200-with-the-code" \
  "$ADM" \
  '  // 8. „übergeben", never „zugestellt"' \
  '  if (result.status === "failed") fail(502, "sms_failed");
  // 8. „übergeben", never „zugestellt"'

# =======================================================================================
# 8 · AN i18n KEY IS DROPPED. The button survives and renders as a raw key or a gap — the
#     same outcome as deleting it, arrived at by a different route.
# =======================================================================================
mutate "the German label for the code button is removed" \
  "$DE" \
  '    "codeIssue": "Zugangscode erstellen",' \
  ''

# =======================================================================================
# 9 · SMS REACHES THE CLOCK-IN PATH. CLOCK-IN IS NEVER BLOCKED BY ANYTHING.
# =======================================================================================
mutate "routes/app.js starts importing the SMS module" \
  "$APP" \
  'import { fail } from "../lib/http.js";' \
  'import { fail } from "../lib/http.js";
import { smsConfigured } from "../lib/sms.js";'

restore_all
echo "== the tree is restored; the check must be GREEN again"
run_check && echo "GREEN after revert" || { echo "STILL RED after revert." >&2; exit 1; }

if ! /usr/bin/git diff --quiet -- $FILES; then
  echo "source is NOT byte-identical to HEAD after this run — restore it by hand." >&2
  exit 1
fi

echo
echo "mutants: $pass red, $fail alive-or-dead"
[ "$fail" -eq 0 ] || exit 1
echo "OK check-fallback-reachable-mutants: every mutant red, tree byte-identical"
