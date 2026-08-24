---
id: TASK-250
title: >-
  ops/prove-sms-live.sh asserts a production state that is no longer true —
  Twilio is LIVE on the box now, and the script seeds fake credentials over it
status: To Do
assignee: []
created_date: '2026-08-24 13:50'
labels:
  - ops
  - sms
  - reliability
dependencies: []
priority: high
ordinal: 168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY THE decision-50/51 VERIFY PASS. The run that just edited this file (commit 7847a89,
decision-51's known/unknown split) did not notice its premise had gone stale, even though its
OWN live verification recorded the fact that invalidates it ('GET /admin/sms-status -> 200
configured:true').

MEASURED ON schimmer-glanz.exe.xyz, this run:
  GET /auth/capabilities                  -> {"sms":true}
  sudo grep ^TWILIO /etc/nfc/env          -> TWILIO_ACCOUNT_SID=AC51c1..., TWILIO_SID=SK1248...,
                                             TWILIO_SECRET=pzfVMt..., TWILIO_FROM=+43670...
  grep -c ^TWILIO_API_BASE /etc/nfc/env   -> 0    (i.e. the REAL api.twilio.com, no stub)
  sms_deliveries                          -> 1 row, 2026-08-24 09:27:44 UTC, status 'sent'
                                             (pre-dates this run's 13:30 deploy — the owner
                                             switched Twilio on this morning)

WHAT THE SCRIPT STILL SAYS:
  line 14   '1  the flag is OFF here, and the server says so in words at every layer it touches'
  line 141  '== 1 · the flag is OFF on this box, and it says so in words'
  line 151  [ "$CODE" = "200" ] && [ "$(jget configured)" = "false" ]     <- HARD ASSERT, fails now
  lines 174/199/207/211  four more 503 sms_not_configured asserts               <- all fail now
  line 287  'the flag did not go back off' teardown assert                      <- fails now

TWO SEPARATE PROBLEMS, and the second is the dangerous one:

1. The script cannot pass. Anyone running it reads a wall of FAILs and learns nothing about
   decision-51, including the known/unknown assertions this run just added to it.

2. §5 WRITES A COMPLETE FAKE CREDENTIAL SET INTO /etc/nfc/env ON PRODUCTION. That was designed
   for a box whose SMS was off and whose env had no real secrets in it. The box now holds LIVE
   Twilio credentials for a paying account. The script does restore and sha256-compare, but the
   window exists, an early abort inside a redirected block is a failure mode the file's own
   header documents, and there is no reason to take that risk against real credentials.

THE FIX IS NOT 'flip the asserts'. §1 exists to prove the OFF path, which is still a state this
system must handle correctly (a lapsed Twilio account). Options, decide explicitly:
  (a) parameterise: read GET /admin/sms-status first and run §1's OFF assertions only when the
      box is genuinely off, printing a SKIP with the reason when it is not;
  (b) move the OFF proof entirely into server/check-sms-flag.mjs (which already flips the flag
      in-process against a local stub, with no production write at all) and reduce this file to
      the ON-path assertions §5 currently smuggles in;
  (c) keep it, but make the §5 env seed refuse to run when /etc/nfc/env contains a TWILIO_SECRET
      that is not the known fake — a one-line guard that makes the dangerous half impossible.
(c) is the smallest thing that removes the risk today; (a) is the smallest thing that makes the
file pass again. They are independent and both are cheap.

DO NOT run ops/prove-sms-live.sh against production until this is resolved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ops/prove-sms-live.sh runs green against schimmer-glanz.exe.xyz in its CURRENT state (SMS configured), or SKIPs the OFF-only sections with the measured reason printed
- [ ] #2 The §5 env seed cannot overwrite a real credential set — proven by seeding a fake TWILIO_SECRET locally and watching the guard refuse
- [ ] #3 The decision-51 known/unknown assertions added in 7847a89 actually execute and pass, rather than being unreachable behind §1's failures
<!-- AC:END -->
