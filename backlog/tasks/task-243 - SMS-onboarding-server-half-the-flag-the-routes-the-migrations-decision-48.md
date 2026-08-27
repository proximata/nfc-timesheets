---
id: TASK-243
title: >-
  SMS onboarding, server half: the flag, the routes, the migrations
  (decision-48)
status: Done
assignee: []
created_date: '2026-08-22 21:53'
updated_date: '2026-08-27 07:33'
labels: []
dependencies: []
ordinal: 161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SHIPPED AND DEPLOYED 2026-08-22. Created retrospectively so the board records what landed.

decision-48: onboarding is an ACTION the admin takes, never a setting on a worker. SMS is a
SECOND DELIVERY CHANNEL for the SAME decision-26 enrolment code and replaces nothing.

BUILT
- 011_sms_onboarding.sql (sms_deliveries), 012_sms_otp.sql (otp_challenges). Additive, applied.
- server/lib/sms.js: smsConfigured()/smsMissing() DERIVED from the credentials. There is no
  SMS_ENABLED boolean, because a hand-typed flag can contradict reality. One fetch, Basic auth
  with the SK pair, Account SID in the URL path, never throws, fixed failure vocabulary.
- POST /admin/workers/:id/enrolment-code/sms (200 CARRYING THE CODE even on a failed send),
  PUT + DELETE /admin/workers/:id/phone (decision-45's named, unbuilt promotion),
  GET /admin/sms-status, POST /auth/sms/request, POST /auth/sms/verify.
- No new npm dependency. No web file. No Kotlin. No iOS.

PROVEN ON PRODUCTION, after the deploy
  boot line                 sms: not configured (missing: account_sid, auth, sender)
  GET /admin/sms-status     configured=false, missing=[account_sid,auth,sender], sender_kind=null
  the SMS route             503 with AND without a login number, so the 503 is the FLAG
  the fallback              POST enrolment-code returned 201, POST /auth/code returned 200 + ts_worker
  sms_deliveries            0 rows after every 503
Every seeded row was deleted; production is back to 0 workers / 0 phone_identities /
0 worker_sessions / 0 sms_deliveries / 0 otp_challenges and 1 admin.

CHECKS, each with its negative case watched RED
  server/check-sms-flag.mjs, server/check-sms-message.mjs, ops/check-fallback-reachable.mjs,
  server/check-phone-namespace.mjs section 3b.
  28 mutants across three mutant runners, all RED, tree byte-identical after.
  ops/deploy.sh step 0 now runs check-fallback-reachable + check-sms-message BEFORE anything moves.

NOT DONE, deliberately: the admin panel UI, Android, and the credentials themselves.
TWILIO_ACCOUNT_SID and a sender still do not exist, so nobody can send an SMS today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migrations 011 and 012 applied on schimmer-glanz.exe.xyz
- [ ] #2 smsConfigured() reads FALSE on production with the real /etc/nfc/env
- [x] #3 Every SMS route fails closed with 503 and writes nothing
- [ ] #4 POST /admin/workers/:id/enrolment-code and POST /auth/code are byte-unchanged and proven live
- [x] #5 No new npm dependency; server deps stay pg + @sentry/node
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27 (read-only; prod read via ssh, no writes, no deploy).
AC1 CHECKED: sudo -u postgres psql nfc 'select filename from schema_migrations order by 1' on schimmer-glanz.exe.xyz lists 011_sms_onboarding.sql and 012_sms_otp.sql (through 013_unbound_zones.sql). Applied.
AC3 CHECKED at source level: the flag guard is the FIRST statement of every SMS handler, ahead of the limiter and every query - routes/admin.js:820 (workers enrolment-code/sms), routes/admin.js:1191 (operators enrolment-code/sms), routes/auth.js:426 (smsRequest), :504 (smsVerify), :626, :697; all 'if (!smsConfigured()) fail(503, "sms_not_configured")'. Nothing is written before that line.
AC5 CHECKED: server/package.json dependencies are exactly @sentry/node 10.68.0 + pg 8.21.0. No new dependency.
AC2 LEFT UNCHECKED - MOOT, not a defect. Production has since been GIVEN credentials: journalctl -u nfc-api shows 'sms: configured (sender: number)' at Aug 27 07:20:42 (and Aug 26 20:09/20:12). smsConfigured() therefore reads TRUE on prod today, so the AC as worded ('reads FALSE on production') can no longer be true and must not be ticked. The behaviour it was protecting - derived, no hand-typed SMS_ENABLED boolean - is intact (lib/sms.js is the single derived predicate, evaluated per request). The 'blocked on the owner for TWILIO_ACCOUNT_SID' note in the earlier comment is now stale.
AC4 LEFT UNCHECKED - cannot be re-proven from here without minting a live enrolment code and a worker session on production, which this read-only audit will not do. The routes exist and are wired (routes/admin.js POST /admin/workers/:id/enrolment-code, routes/auth.js POST /auth/code); byte-unchanged + live 201/200 was evidenced in the 2026-08-23 comment. Not re-verified this run.
Verdict: shipped work is present; status stays Done.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-22 23:07
---
VERIFIED LIVE 2026-08-23, by a pass that trusted none of the above and measured the box.

DEPLOYED: ops/check-box-serves-head.sh OK at ec8f11a — the admin bundle, the browser JS/CSS,
server.js, lib/, routes/ and the published APK (0.5.5 / versionCode 12) all match this tree
byte for byte. schema_migrations tops out at 012_sms_otp.sql.

THE FLAG IS OFF, AND THE OFF WAS MADE TO FAIL FIRST (ops/prove-sms-live.sh, new, committed):
  journalctl              sms: not configured (missing: account_sid, auth, sender)
  GET  /admin/sms-status  200 {configured:false, missing:[account_sid,auth,sender]}
  GET  /auth/capabilities 200 {sms:false}
  POST /auth/sms/request  503   /auth/sms/verify 503   otp_challenges 0
  POST /admin/workers/:id/enrolment-code/sms   503 with NO number AND 503 WITH a number
       -> the live enrolment code was NOT re-minted; NO sms_deliveries row was written
  THEN the flag was SEEDED ON on the live box (fake but correctly shaped credentials,
  TWILIO_API_BASE on a dead loopback port so nothing can leave the machine):
    RED  /auth/capabilities -> {sms:true}          the OFF assertion would FAIL
    RED  .../enrolment-code/sms -> 200, not 503    the OFF assertion would FAIL
    RED  /auth/sms/request -> 202                  the OFF assertion would FAIL
    ok   the 200 CARRIED A WORKING CODE, delivery.status=failed, reason network:ECONNREFUSED,
         and that code redeemed at /auth/code -> 200
    ok   sms_deliveries row: failed|network:ECONNREFUSED|- — never 'sent'
  /etc/nfc/env restored and compared by sha256: identical. The 503s came back.

THE ENROLMENT CODE, UNCHANGED, ON THE SAME BOX, IN THE SAME MINUTE:
  POST /admin/workers/:id/enrolment-code  201 FNHJ-8Z84
  POST /auth/code {FNHJ-8Z84}             200 + Set-Cookie ts_worker; Max-Age=7775999
  POST /auth/code {FNHJ-8Z84} again       401  (single use, unchanged)

CLEANED UP: production is back to 0 locations / 0 zones / 0 clients / 0 contacts / 0 workers /
0 shifts / 0 operators / 0 phone_identities / 0 sms_deliveries / 0 otp_challenges /
0 worker_sessions, 1 admin (id 2, 'schimmer'), 2 pre-existing browser sessions from 19 and 21
August. Every admin session this pass minted was deleted by hash.

STILL BLOCKED ON THE OWNER: TWILIO_ACCOUNT_SID (AC…) and one sender (TWILIO_FROM or
TWILIO_MESSAGING_SERVICE_SID). See TASK-245 — the env file names a sync script that does not
exist, so there is nowhere the documented procedure says to put them.
---
<!-- COMMENTS:END -->
