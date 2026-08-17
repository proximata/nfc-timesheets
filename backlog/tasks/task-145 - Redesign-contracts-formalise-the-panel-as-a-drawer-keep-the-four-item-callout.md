---
id: TASK-145
title: >-
  Redesign /contracts/: formalise the panel as a drawer, keep the four-item
  callout
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
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Was ist vereinbart, und seit wann?"

Batch B2 (REDESIGN-PLAN.md section 4.2). Inventory section 8: 670 lines, ns contracts, 69 keys. Class MIXED - a read-only buildings table + a per-building history table + a create form inside a panel that already receives focus. The panel is already close to a drawer; formalise it.

The four-item standing callout is the point of this screen and is PERMANENT, not a tooltip and not an accordion. noteLabourNoHistory in particular (decision-28: workers.hourly_rate_cents is still ONE mutable column, so revenue is period-correct and cost is not) is the same fact /payroll/ states as caveatRateHistory. BOTH copies must survive - they are read by different people at different moments.

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
- [ ] #1 The create-a-period form is a Drawer; the buildings table and the history table are read-only
- [ ] #2 PageHeader renders the h1 and „Was ist vereinbart, und seit wann?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 All four standing-callout items still render permanently and unconditionally: noteRevenueHistory, noteLabourNoHistory, noteDates, noteMirror + its link to /locations/
- [ ] #4 periodClosed still renders the exclusive bound as the last day it applied (valid_to minus one day), and periodCurrent {from} still renders for the open period
- [ ] #5 The undo/delete control is drawn ONLY on the current period; closed periods still show closedNoUndo, and deleting the current period still goes through a ConfirmModal because it is irreversible
- [ ] #6 errorDateShape still rejects a non-calendar day: entering 2026-02-31 is refused and never rolls forward to 2 March
- [ ] #7 errorOverlap still lands on the date field AND as a form error; errorNotCurrent still renders on a 409 delete
- [ ] #8 historyEmpty {name} still renders with historyEmptyConsequence and the link to /pl/ - an unpriced building reports UNKNOWN revenue, and that sentence is the whole point of the state
- [ ] #9 The no-buildings-at-all notice with its link to /locations/ survives; noPrice, noTarget, buildingInactive, noClient, noNote all still render
- [ ] #10 newIntroFirst vs newIntroReplaces {amount, from} still distinguish a first contract from a replacement; all five hints (validFromHint, monthlyHint, targetHint, clientHint, noteHint) survive
- [ ] #11 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached
- [ ] #12 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
