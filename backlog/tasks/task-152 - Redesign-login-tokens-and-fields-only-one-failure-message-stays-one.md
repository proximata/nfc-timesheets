---
id: TASK-152
title: 'Redesign /login/: tokens and fields only, one failure message stays one'
status: To Do
assignee: []
created_date: '2026-08-17 13:24'
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
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No question line. Plan section 4.4 lists /login/ as the one screen with no shell and no Frage.

Batch B4 (REDESIGN-PLAN.md section 4.2). Inventory section 13: 106 lines, ns login, 8 keys. Class pure FORM. Renders OUTSIDE the admin shell - AppShell returns a bare auth-main, so no nav, no sign-out, no locale switcher. Tokens and .field / .btn only. Effort low; this is the smallest task in the workstream.

THE SECURITY LINE: there is ONE failure message for every rejected credential. Do not split it into friendlier per-cause messages during the redesign - „unknown user" versus „wrong password" is a user-enumeration oracle. The transport/server branch differs only because it says nothing about the account.

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
- [ ] #1 login.failed is still ONE message for every rejected credential; the diff contains no per-cause variant that could distinguish unknown user from wrong password
- [ ] #2 The transport/server branch (status 0 or >=500) still renders separately and still says nothing about whether the account exists
- [ ] #3 The identity field is still type=text with autoComplete=username, NOT type=email - the admin identity is a username (decision-20)
- [ ] #4 autoFocus and its existing biome-ignore comment, including the justification in that comment, are preserved verbatim
- [ ] #5 The page still renders outside AppShell: no nav, no sign-out, no locale switcher appear on it
- [ ] #6 No PageHeader question line is added - plan section 4.4 gives /login/ no Frage
- [ ] #7 The role=alert region is still always mounted, and the pending state still disables all inputs and shows login.submitting
- [ ] #8 No Drawer, no Modal, no new component; tokens plus .field and .btn only
- [ ] #9 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached
- [ ] #10 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
