---
id: TASK-151
title: >-
  Redesign /account/: pure form, no reset control, hint stays in step with the
  server
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
priority: low
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Wer bin ich hier, und wie melde ich mich ab?" (REDESIGN-PLAN.md section 4.4)

Batch B4 (REDESIGN-PLAN.md section 4.2). Inventory section 12: 124 lines, ns account, 13 keys. Class pure FORM - already one job, so no drawer. Tokens, PageHeader, Field, .btn. Effort low.

NOTE, decide and write it down: this is the ONE screen that already states its own question, as account.question „Wie ändere ich mein Passwort?" rendered in .lede. Plan section 4.4 assigns it the broader „Wer bin ich hier, und wie melde ich mich ab?". Section 4.4 wins for the h1 question line; do not silently delete the existing account.question key - either re-point it or record its removal in the task before removing it.

NO PASSWORD RESET CONTROL MAY BE ADDED. The absence is deliberate: the admin identity is a USERNAME, not an address, and this deployment has no outbound mail. A reset link we cannot send is a dead end that looks like a feature. Recovery is the operator, on the machine.

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
- [ ] #1 PageHeader renders the h1 and „Wer bin ich hier, und wie melde ich mich ab?" from REDESIGN-PLAN.md section 4.4; the fate of the existing account.question key is recorded in the task, not decided silently
- [ ] #2 NO reset-by-email control, link or hint is added anywhere on the screen. Stating on screen WHY there is none is permitted; offering one is not
- [ ] #3 account.hint {min: 5} still renders and still matches PASSWORD_MIN in server/routes/admin.js - value read from the server file, which is NOT edited
- [ ] #4 There is still ONE live region carrying both success and failure, so the page does not reflow differently for the two outcomes
- [ ] #5 The three autoComplete values are unchanged: current-password, new-password, new-password
- [ ] #6 All six outcome states still render: saving (button text, disabled), done (form reset), tooShort {min}, mismatch, wrongCurrent (401), rejected (422), plus the generic tError branch
- [ ] #7 The form still uses .auth-form, not .worker-form, and still renders correctly under the new token set
- [ ] #8 No Drawer and no Modal is added; the screen is already one job
- [ ] #9 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached; every touch target >=44px
- [ ] #10 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
