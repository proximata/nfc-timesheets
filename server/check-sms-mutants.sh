#!/bin/sh
# THE NEGATIVE CASES FOR check-sms-flag.mjs AND check-sms-message.mjs.
#
#   sh server/check-sms-mutants.sh
#
# A CHECK WHOSE NEGATIVE CASE CANNOT FAIL IS NOT A CHECK. Everything the SMS work claims —
# "it fails closed", "it never pretends", "the code comes back anyway", "the message is one
# GSM-7 segment in Vienna time" — is a claim about what happens when something goes WRONG,
# and none of it is evidence until the assertion has been watched to fire.
#
# Each mutant edits ONE site of SOURCE — never an assertion — runs the check against it and
# demands a NON-ZERO exit. Then it restores the file and demands a ZERO exit again, so a
# mutant that fails to revert cannot leave a green run behind it.
#
# WHY SOURCE AND NOT THE CHECK. Mutating an assertion proves the assertion runs. Mutating
# the code proves the assertion CATCHES the regression it was written for. Same shape and
# same reasoning as server/check-phone-namespace-mutants.sh.
#
# NO REAL SMS IS SENT BY ANY MUTANT. Every run points TWILIO_API_BASE at 127.0.0.1.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

SMS="server/lib/sms.js"
ADM="server/routes/admin.js"
AUT="server/routes/auth.js"
FILES="$SMS $ADM $AUT"

BACKUP=$(mktemp -d)
key() { echo "$1" | tr / _; }
trap 'for f in $FILES; do b="$BACKUP/$(key "$f")"; [ -f "$b" ] && cp "$b" "$f"; done; rm -rf "$BACKUP"' EXIT INT TERM
for f in $FILES; do cp "$f" "$BACKUP/$(key "$f")"; done
restore_all() { for f in $FILES; do cp "$BACKUP/$(key "$f")" "$f"; done; }

run_flag() { node server/check-sms-flag.mjs >/dev/null 2>&1; }
run_message() { node server/check-sms-message.mjs >/dev/null 2>&1; }

pass=0
fail=0

# $1 name  $2 file  $3 from  $4 to  $5 runner
mutate() {
  name="$1"; file="$2"; from="$3"; to="$4"; runner="$5"
  restore_all
  if ! /usr/bin/grep -qF -- "$from" "$file"; then
    echo "DEAD  $name — site not found in $file"
    fail=$((fail + 1))
    restore_all
    return
  fi
  # perl -0777 and not sed: the sites below carry slashes, braces and newlines.
  FROM="$from" TO="$to" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if $runner; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

# Two sites, ONE semantic change. Used where a property is enforced twice on purpose and
# neither half alone is observable from outside the process — see mutant 8.
mutate_pair() {
  name="$1"; file="$2"; from1="$3"; to1="$4"; from2="$5"; to2="$6"; runner="$7"
  restore_all
  if ! /usr/bin/grep -qF -- "$from1" "$file" || ! /usr/bin/grep -qF -- "$from2" "$file"; then
    echo "DEAD  $name — a site was not found in $file"
    fail=$((fail + 1))
    restore_all
    return
  fi
  FROM="$from1" TO="$to1" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  FROM="$from2" TO="$to2" perl -0777 -i -pe 's/\Q$ENV{FROM}\E/$ENV{TO}/' "$file"
  if $runner; then
    echo "ALIVE $name — the mutant PASSED. The assertion does not fire."
    fail=$((fail + 1))
  else
    echo "RED   $name"
    pass=$((pass + 1))
  fi
  restore_all
}

echo "== baseline (must be GREEN before any mutant means anything)"
run_message && echo "GREEN check-sms-message" \
  || { echo "BASELINE IS RED — fix that first." >&2; exit 1; }
run_flag && echo "GREEN check-sms-flag" \
  || { echo "BASELINE IS RED — fix that first." >&2; exit 1; }

# =======================================================================================
# 1 · THE GUARD IS REMOVED. This is THE mutant of this run. Without the flag check the
#     admin route walks straight past 503, mints a code and calls a carrier that is not
#     configured — i.e. it TRIES on a box with no credentials. The check must see the
#     503 disappear.
# =======================================================================================
mutate "the admin SMS route stops checking the flag — it mints and tries anyway" \
  "$ADM" \
  '  if (!smsConfigured()) fail(503, "sms_not_configured");' \
  '  /* MUTANT: guard removed */' \
  run_flag

# =======================================================================================
# 2 · THE GUARD MOVES BEHIND THE MINT. The 503 still comes back, so a lazy check passes —
#     but the worker's enrolment code has already been REPLACED by a code nobody will ever
#     receive, on a box that cannot send. That is a live credential silently rotated by a
#     button that reported failure. §1's "byte-identical before and after" is what catches it.
# =======================================================================================
mutate "the flag is checked AFTER the code is minted — a 503 that still burns a code" \
  "$ADM" \
  '  if (!smsConfigured()) fail(503, "sms_not_configured");

  const worker = await one(' \
  '  const worker = await one(' \
  run_flag

# =======================================================================================
# 3 · IT PRETENDS. A non-2xx is recorded as 'sent'. The panel would say „SMS übergeben"
#     for a message Twilio refused — the exact silent pretence the owner forbade.
# =======================================================================================
mutate "a rejected message is recorded as 'sent'" \
  "$SMS" \
  '      return { status: "failed", reason: `http_${res.status}`, provider_code: providerCode };' \
  '      return { status: "sent", provider_sid: "SM00000000000000000000000000000000" };' \
  run_flag

# =======================================================================================
# 4 · THE FALLBACK IS SWALLOWED. A failed send becomes a 5xx, so the panel's error path
#     eats the body and the admin is left with nothing — the single failure decision-48 §7
#     exists to make unreachable.
# =======================================================================================
mutate "a failed send becomes a 5xx and the code never reaches the screen" \
  "$ADM" \
  '  return {
    status: 200,
    body: {
      ...body,
      delivery: {' \
  '  if (result.status === "failed") fail(502, "sms_failed");
  return {
    status: 200,
    body: {
      ...body,
      delivery: {' \
  run_flag

# =======================================================================================
# 5 · A MALFORMED ACCOUNT SID TURNS THE FEATURE ON. `TWILIO_ACCOUNT_SID=yes` would then be
#     "configured", the button would be live, and every press would fail at the wire with a
#     404 from Twilio — reported to the director as "we tried", when the truth is "this box
#     was never set up".
# =======================================================================================
mutate "a present-but-malformed Account SID counts as configured" \
  "$SMS" \
  '  return v && ACCOUNT_SID_RE.test(v) ? v : null;' \
  '  return v;' \
  run_flag

# =======================================================================================
# 6 · /auth/sms/request STOPS FAILING CLOSED. Without the flag check the phone gets a 202,
#     believes a message is on its way, and waits for one that cannot exist.
# =======================================================================================
mutate "POST /auth/sms/request answers 202 on a box with no credentials" \
  "$AUT" \
  'async function smsRequest({ body, ip }) {
  if (!smsConfigured()) fail(503, "sms_not_configured");' \
  'async function smsRequest({ body, ip }) {' \
  run_flag

# =======================================================================================
# 7 · THE ENUMERATION GUARD IS BYPASSED (decision-51). An unknown number must get 404
#     unknown_phone, on purpose — not the old byte-identical 202. Restoring the 202 for a
#     number that resolves to nothing is exactly the regression this mutant reproduces.
# =======================================================================================
mutate "an unknown number gets 202 instead of 404 — the enumeration guard is bypassed" \
  "$AUT" \
  '  if (!target) fail(404, "unknown_phone");' \
  '  if (!target) return { status: 202, body: { status: "accepted" } };' \
  run_flag

# =======================================================================================
# 8 · THE OTP STOPS BEING SINGLE USE. One intercepted code mints sessions for ever.
#
#     TWO SITES, ON PURPOSE, AND THE REASON IS MEASURED RATHER THAN ASSUMED. Single use is
#     enforced twice: the candidate SELECT filters `consumed_at IS NULL`, and the redemption
#     UPDATE repeats the predicate so the DATABASE decides a race. Mutating either one ALONE
#     cannot be killed through HTTP:
#
#       * SELECT only  -> the UPDATE still refuses. Sequential replay is 401.
#       * UPDATE only  -> the SELECT still refuses a SEQUENTIAL replay, and the concurrent
#                         case in check-sms-flag §4 could not be made to fail: measured with
#                         EIGHT simultaneous verifications against the mutant, the result was
#                         still 1x200 / 7x401 and one worker_sessions row, because node
#                         dispatches the request handlers in a way that lands the winner's
#                         UPDATE before the losers' SELECT. The predicate inside the UPDATE
#                         is genuine defence in depth against a race this harness cannot
#                         provoke from outside the process — a NAMED CEILING on this file,
#                         not a claim that it is unnecessary. (Provoking it needs two raw
#                         clients holding open transactions, which would be a test of SQL
#                         written by the test rather than of the route.)
#
#     So the honest formulation is ONE SEMANTIC CHANGE ACROSS BOTH SITES: "single use is no
#     longer enforced". That the sequential replay case then goes red is exactly right.
# =======================================================================================
mutate_pair "the OTP can be redeemed twice (single use removed from BOTH sites)" \
  "$AUT" \
  '            AND c.consumed_at IS NULL
' \
  '' \
  '      WHERE id = $1 AND code_hash = $2 AND expires_at > now()
        AND consumed_at IS NULL AND attempts < $3' \
  '      WHERE id = $1 AND code_hash = $2 AND expires_at > now()
        AND attempts < $3' \
  run_flag

# =======================================================================================
# 9 · A WRONG ANSWER COSTS NOTHING. Without burning an attempt the 5-guess cap in the
#     arithmetic is fiction and 10^6 is walkable at the rate limiter's pace.
# =======================================================================================
mutate "a wrong OTP does not burn an attempt" \
  "$AUT" \
  '    if (phone !== null) {
      await query(' \
  '    if (false) {
      await query(' \
  run_flag

# =======================================================================================
# 10 · THE EXPIRY IS RENDERED IN UTC. It reads as a real time and is an hour or two early;
#      the code appears to expire before it does. (check-sms-message)
# =======================================================================================
mutate "the expiry is formatted in UTC instead of Europe/Vienna" \
  "$SMS" \
  '  timeZone: "Europe/Vienna",
  hour: "2-digit",' \
  '  timeZone: "UTC",
  hour: "2-digit",' \
  run_message

# =======================================================================================
# 11 · A GERMAN TYPOGRAPHIC QUOTE ENTERS THE TEMPLATE. One character flips the whole SMS to
#      UCS-2: the limit halves to 70 septets and a 108-character message becomes three
#      segments — triple the money and three chances to arrive out of order. Nothing on any
#      screen would say so. (check-sms-message)
# =======================================================================================
mutate "a „ quote enters the message template and silently triples the cost" \
  "$SMS" \
  '    "Bitte in der App eingeben."' \
  '    "Bitte in der App „eingeben“."' \
  run_message

restore_all
echo "== the tree is restored; both checks must be GREEN again"
run_message && run_flag && echo "GREEN after revert" \
  || { echo "STILL RED after revert — the tree was not restored cleanly." >&2; exit 1; }

if ! /usr/bin/git diff --quiet -- $FILES; then
  echo "source is NOT byte-identical to HEAD after this run — restore it by hand." >&2
  exit 1
fi

echo
echo "mutants: $pass red, $fail alive-or-dead"
[ "$fail" -eq 0 ] || exit 1
echo "OK check-sms-mutants: every mutant red, tree byte-identical"
