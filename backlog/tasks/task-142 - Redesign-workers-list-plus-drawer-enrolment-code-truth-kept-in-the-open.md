---
id: TASK-142
title: 'Redesign /workers/: list plus drawer, enrolment-code truth kept in the open'
status: To Do
assignee: []
created_date: '2026-08-17 13:23'
labels:
  - ux
  - redesign
dependencies:
  - TASK-136
  - TASK-137
  - TASK-138
  - TASK-139
documentation:
  - backlog/docs/REDESIGN-PLAN.md
  - backlog/docs/REDESIGN-INVENTORY.md
priority: high
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Wer arbeitet für uns, und wer kommt noch nicht rein?"

Batch B1 (REDESIGN-PLAN.md section 4.2). Inventory section 4: 643 lines, ns workers, 61 keys, 5 inputs. Class MIXED - list + permanently-open create/edit form + a one-shot secret panel. HIGHEST DENSITY OF LOAD-BEARING TRUTH ON ANY SCREEN.

The create/edit form moves into a Drawer. The enrolment-code machinery does NOT get tidied away: the one-shot code panel must still identify the row it belongs to, because the director reads the code out over the phone. The prototype's centred modal titled „Zugangscode für <Name>" satisfies this; a bare modal does not.

Revoke sits in the open at the SAME visual weight as issue, on purpose - seconds matter when a code went to the wrong person. Do not bury it in a menu.

RULES FOR EVERY SCREEN AGENT (REDESIGN-PLAN.md section 4.1):
- You own web/app/<this screen>/page.tsx and your two fragment files. Nothing else.
- DO NOT edit globals.css, lib/nav.ts, components/* (Foundation owns them) or de.json/en.json (Merge owns them).
- New strings go to web/messages/_fragments/<screen>.de.json and .en.json, top-level keys = namespaces. Reference them in code as if already merged.
- web/lib/*.ts is FROZEN. If the screen cannot be built without a lib change, write it in the task and stop.
- server/, NFCTimeSheets/, ops/branding.json and the well-known files are out of scope. Write it down instead of doing it.
- Run: cd web && pnpm lint && pnpm typecheck. NOT pnpm verify - pnpm check compares de.json to en.json and your keys are still in fragments, so it fails by design until the Merge task.
- Tabular data stays <table class="data-table"> with thead/tbody. Do not convert a table to divs: it breaks the <=767px card transform and ResponsiveTableLabels.
- Money is integer CENTS end to end. Never a float multiply. tabular-nums everywhere.
- Nothing TRUE may be deleted to make the screen lighter. Move it or typeset it smaller.
- Production is READ-ONLY. No deploy, no restart, no write.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The permanently-open create/edit form is gone from the page body; every write happens in a Drawer opened by an explicit control
- [ ] #2 PageHeader renders the h1 and „Wer arbeitet für uns, und wer kommt noch nicht rein?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 codeStandingNote still renders PERMANENTLY and ABOVE the controls that create a code, with both of its facts intact: the code is shown once and cannot be looked up, AND the email address is still what gets an iPhone in (decision-22)
- [ ] #4 The fresh-code panel still names the worker (codeExplain {name}) so the row it belongs to is identifiable, still shows codeOnce and codeValidUntil {expires}, and still receives focus on appearing
- [ ] #5 The revoke control is at the same visual weight as issue and is NOT inside a menu, an overflow or a hover affordance
- [ ] #6 All five code states still render as words: codeNone, codeLive {expires}, codeExpired {expires}, codeRedeemed {date}, codeInactive - and the 30s CODE_TICK_MS tick still flips a live code to expired without a reload
- [ ] #7 noEmail still renders muted and still means this person can never sign in on iPhone; emailHint (Apple relay address) and phoneHint (the phone number is NOT a login) both survive verbatim
- [ ] #8 errorEmailTaken still lands on the email FIELD as well as in the form error; errorNameRequired, errorEmailShape, errorPhoneShape, errorRateInvalid all still fire
- [ ] #9 Deactivate/reactivate still re-sends EVERY column - proven by deactivating a worker with a rate and a phone, reactivating, and confirming both values survive
- [ ] #10 Issuing a code, revoking a code and deactivating a worker each go through a ConfirmModal or an equally explicit confirmation; issue is destructive (it kills the previous code immediately)
- [ ] #11 codeCopied / codeCopyFailed / codeRevoked / codeRevokeFailed / codeIssueFailed are announced on the PAGE live region, not inside an overlay that closes
- [ ] #12 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached; every touch target >=44px
- [ ] #13 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
