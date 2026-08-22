---
id: TASK-244
title: >-
  SMS onboarding, panel half: two buttons in one cell, and the code button never
  conditional
status: To Do
assignee: []
created_date: '2026-08-22 21:53'
labels:
  - decision-48
dependencies: []
ordinal: 162000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The server half is DONE and deployed (TASK-243, decision-48). The panel is not started, and
this task is the whole of what remains before an admin can see any of it.

decision-48 section 2.5 and section 8 are the spec. The endpoint contract is in the run store
under key "server", and in backlog/docs/SMS-ONBOARDING.md sections 5.1, 3.4 and 4.3.

WHAT THE SERVER ALREADY GIVES THE PANEL
  GET  /admin/sms-status                       {configured, missing[], sender_kind}
  POST /admin/workers/:id/enrolment-code/sms   200 CARRYING THE CODE even when the send failed
  PUT  /admin/workers/:id/phone   {phone}      200 {phone_e164} | 409 phone_claimed
  DELETE /admin/workers/:id/phone              200
  GET  /admin/data workers[] gained            phone_e164, sms_last_status, sms_last_reason,
                                               sms_last_at, sms_count

THE TWO RULES THAT ARE GATED, NOT ADVISORY
1. The Zugangscode erstellen button's render condition may mention NONE of smsConfigured /
   sms_deliveries / phone_identit / sms_last / smsStatus. ops/check-fallback-reachable.mjs
   greps exactly that and runs in ops/deploy.sh step 0, so a violation stops the deploy.
2. The SMS senden button is RENDERED ALWAYS and merely disabled when configured is false, with
   the reason beside it in words. Never hidden: hiding it deletes something true, namely that
   this system has an SMS path and it is switched off. Colour is the SECOND signal.

Two buttons in the same cell at the same weight, both usable any number of times in any order,
for every active worker, for ever. There is no stored preference and there must never be one.

The de/en key table is decision-48 section 8. Exact key parity, real Austrian business German,
uebergeben and never zugestellt, and web/scripts/check.mjs already enforces plural one+other.

390px: the workers table already carries seven columns and its own comment says it cannot take
another, so this goes INSIDE the existing code cell and the existing phone cell.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SMS senden is rendered for every active worker and merely disabled when GET /admin/sms-status says configured=false, with the reason in words beside it
- [ ] #2 Zugangscode erstellen is unchanged and its render condition mentions no SMS name; ops/check-fallback-reachable.mjs stays green
- [ ] #3 A failed send still shows the code, because the 200 carries it
- [ ] #4 Login-Nummer is shown, editable via PUT/DELETE .../phone, and never overwrites the free-text Telefon
- [ ] #5 de/en exact key parity; web/scripts/check.mjs green; 390px verified in a real browser via demo/cdp.mjs
<!-- AC:END -->
