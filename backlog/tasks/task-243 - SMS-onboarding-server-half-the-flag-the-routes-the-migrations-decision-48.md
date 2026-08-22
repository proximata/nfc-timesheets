---
id: TASK-243
title: >-
  SMS onboarding, server half: the flag, the routes, the migrations
  (decision-48)
status: Done
assignee: []
created_date: '2026-08-22 21:53'
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
- [ ] #1 Migrations 011 and 012 applied on schimmer-glanz.exe.xyz
- [ ] #2 smsConfigured() reads FALSE on production with the real /etc/nfc/env
- [ ] #3 Every SMS route fails closed with 503 and writes nothing
- [ ] #4 POST /admin/workers/:id/enrolment-code and POST /auth/code are byte-unchanged and proven live
- [ ] #5 No new npm dependency; server deps stay pg + @sentry/node
<!-- AC:END -->
