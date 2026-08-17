---
id: TASK-147
title: >-
  Redesign /material-requests/: paperwork to a drawer, lifecycle buttons stay on
  the row
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
priority: medium
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Worauf wartet gerade jemand vor Ort?"

Batch B2 (REDESIGN-PLAN.md section 4.2). Inventory section 3: 663 lines, ns materials, 81 keys. Class MIXED - a read-only queue with per-row lifecycle buttons plus an optional paperwork form.

ONLY THE PAPERWORK MOVES INTO A DRAWER. The per-row lifecycle buttons are the POINT of the screen - a worker is standing in a building waiting on that queue - and they stay ON the row. This is also why /material-requests/ stays top-level in the nav and not under Stammdaten (see nav.ts comment, TASK-139).

MATERIAL_TRANSITIONS is forward-only and rejected/arrived are TERMINAL, so those two advances need a ConfirmModal.

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
- [ ] #1 The per-row lifecycle buttons are still ON the row and reachable in one click; only the paperwork form (item, quantity, cost, location, admin note) moved into a Drawer
- [ ] #2 PageHeader renders the h1 and „Worauf wartet gerade jemand vor Ort?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 Advancing to rejected or arrived goes through a ConfirmModal that states the transition is terminal and cannot be undone
- [ ] #4 All three standing-callout items still render permanently: notePolling (there is NO push - arrived means the row moved, not that a phone buzzed), noteAttribution (decision-6, the building select is CONTEXT not cost attribution), noteUnpriced
- [ ] #5 locationHint still sits AT the building control, where the implication it corrects is made
- [ ] #6 The worker s own words still render verbatim inside <q> so it is obvious they are not ours
- [ ] #7 unpricedWarning {unpriced} with its link to /pl/ still renders when any request is unpriced; truncated {limit} still renders at the 500 cap
- [ ] #8 costMissing still renders NOT muted while costNotYet still renders muted - the distinction between a missing price and a price that is not due yet survives
- [ ] #9 All five stages still render as words (stageDecide, stageOrder, stageDeliver, stageDone, stageRefused), stageDecide rows still carry .row-attention, and timelineArrived vs timelineSeen still differ
- [ ] #10 A 409 (row moved under us) still shows errorMoved AND still triggers the automatic reload; an empty patch still shows detailUnchanged and sends no request
- [ ] #11 Both empty states survive: emptyOpen with the emptyShowAll {total} escape button, and emptyAll
- [ ] #12 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached; lifecycle buttons >=44px there
- [ ] #13 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
