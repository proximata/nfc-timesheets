---
id: TASK-244
title: >-
  SMS onboarding, panel half: two buttons in one cell, and the code button never
  conditional
status: In Progress
assignee: []
created_date: '2026-08-22 21:53'
updated_date: '2026-08-22 23:07'
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
- [x] #1 SMS senden is rendered for every active worker and merely disabled when GET /admin/sms-status says configured=false, with the reason in words beside it
- [x] #2 Zugangscode erstellen is unchanged and its render condition mentions no SMS name; ops/check-fallback-reachable.mjs stays green
- [x] #3 A failed send still shows the code, because the 200 carries it
- [ ] #4 Login-Nummer is shown, editable via PUT/DELETE .../phone, and never overwrites the free-text Telefon
- [x] #5 de/en exact key parity; web/scripts/check.mjs green; 390px verified in a real browser via demo/cdp.mjs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIAL. AC 1/2/3/5 shipped and verified; AC 4 (Login-Nummer editable via PUT/DELETE
.../phone) explicitly NOT built this run -- out of scope for the "build the picker" ask
this run received, and left for a follow-up.

WHAT SHIPPED (web/app/workers/page.tsx, web/lib/api.ts, web/messages/de.json + en.json):
- "SMS senden" beside "Zugangscode erzeugen" in the SAME code cell, same weight, both
  usable any number of times, for every active worker.
- Disabled + aria-disabled + a German/English reason IN WORDS for every unavailable
  reason: flag off (today's real production state), sms-status not loaded yet (fail
  closed), and no login number on file -- never just missing.
- A successful or failed send both open the SAME standing code panel issueCode() uses,
  because a failed send is still a 200 carrying the code (decision-48 par 5.1) -- no
  second UI for the same fact.
- The row remembers the LAST attempt after a reload (worker.sms_last_status/_reason/_at
  from the append-only sms_deliveries log the server already joins) -- not a preference,
  a fact about what happened.
- "Zugangscode erzeugen" is untouched byte-for-byte: node ops/check-fallback-reachable.mjs
  green before and after.

PROOF: demo/check-sms-picker.mjs, 20/20 green, self-contained (imports server/server.js
in-process, flips smsConfigured() between two page loads with no restart, against a
throwaway local Twilio stub -- no real SMS sent, none could be). Covers flag off at 1680
and 390px, a sabotage self-test proving the disabled-state oracle can actually fail, flag
on with/without a phone, a real successful send, a real failed send (http_400), and the
code button still reachable in one click after both. Screenshots in
/tmp/ts-demo/sms-picker/ (gitignored).

DEPLOYED AND MEASURED LIVE on schimmer-glanz.exe.xyz (session minted directly in the
database, no guessed admin password): GET /admin/sms-status returns 200
{configured:false, missing:[account_sid,auth,sender], sender_kind:null}; the live JS
bundle serves "SMS senden" and "SMS ist nicht eingerichtet. Code vorlesen oder
kopieren." verbatim. Production remains 0 workers, 0 locations -- untouched beyond the
one throwaway admin session, which was deleted afterward (2 pre-existing sessions
remain, same as before this run).

REMAINING FOR AC 4: PUT/DELETE /admin/workers/:id/phone already exist server-side
(TASK-243) and are wired into no UI. A "Login-Nummer" cell/drawer field is a separate,
sizeable piece of work and was not asked for in this run's instructions, which named
"the picker" specifically.

Commits: 6fe5921 (the picker), c00e4b2 (demo/check-sms-picker.mjs), deployed via
./ops/deploy.sh at commit c00e4b2.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-22 23:07
---
VERIFIED LIVE 2026-08-23. The panel half that DID ship is real on the box; AC4 is still open and this comment does not close it.

NEW: ops/prove-sms-panel-live.mjs — drives a real headless Chrome against
https://schimmer-glanz.exe.xyz/workers/ with an admin cookie minted straight into the
database (never a guessed password), against a REAL worker row created for the run.

  1+2  'SMS senden' is RENDERED for the active worker, disabled + aria-disabled, with the
       reason in words beside it: 'SMS ist nicht eingerichtet. Code vorlesen oder kopieren.'
       'Zugangscode erstellen' is in the SAME cell, ENABLED, one click away.
  3    THE SABOTAGE SELF-TEST, on the live DOM: the disabled attribute is stripped and the
       reason paragraph deleted, and the SAME oracle then reports three defects
       (not disabled / aria-disabled null / reason sentence missing). Reload -> green again.
       The oracle can fail, so its green means something.
  4    The button was PRESSED for real: the standing code panel opened with 01AR-JWT6 and
       that code redeemed at POST /auth/code -> 200. The fallback is a credential, not a
       rendering.
  5    390px: both buttons, the sentence, and no horizontal overflow.

Screenshots on disk at /tmp/ts-prove/sms-panel-live/ (docs/media is gitignored wholesale).
Every row the run created was deleted; production is back to 0 workers / 0 locations /
1 admin / 2 pre-existing sessions.

ONE COPY CORRECTION for whoever picks up AC4: the German label is 'Zugangscode erstellen'
(de.json workers.codeIssue). Earlier notes on this task say 'Zugangscode erzeugen', which is
not a string that exists in the bundle. Do not grep for it.

AC4 REMAINS: PUT/DELETE /admin/workers/:id/phone are live and proven over HTTP but wired into
no UI, so a worker cannot be given a Login-Nummer without curl — which means that even with
Twilio credentials in place, nobody could be sent an SMS through the panel.
---
<!-- COMMENTS:END -->
