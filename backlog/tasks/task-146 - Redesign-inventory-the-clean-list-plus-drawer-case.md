---
id: TASK-146
title: 'Redesign /inventory/: the clean list-plus-drawer case'
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
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Was haben wir, und was kostet es?"

Batch B2 (REDESIGN-PLAN.md section 4.2). Inventory section 7: 394 lines, ns inventory, 37 keys. Class LIST - the cleanest drawer candidate in the app. 4 fields, 1 list, no filters. Build the pattern here exactly as the B1 screens did; invent nothing.

THE ONE FACT THAT MUST NOT BE PRETTIFIED: unit_cost_cents === 0 means „nobody has priced this", NOT „free". Rendering EUR 0,00 would feed a wrong number into a later cost calculation (decision-6 divides these pro-rata by labour hours).

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
- [ ] #1 The permanently-open create/edit form is gone; writes happen in a Drawer with one job
- [ ] #2 PageHeader renders the h1 and „Was haben wir, und was kostet es?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 unit_cost_cents === 0 still renders noCost muted and NEVER EUR 0,00 - verified by looking at an unpriced item on screen
- [ ] #4 An EMPTY cost input is still accepted and still means 0 = not priced yet, while a typo still fails with errorCostInvalid and never silently becomes zero
- [ ] #5 Products and equipment remain ONE list with the kind as a value on the row (kindProduct / kindEquipment), not two lists and not two tabs
- [ ] #6 kindHint and costHint survive; statusInactive still renders in WORDS on .row-inactive; errorNameRequired and errorGone still fire
- [ ] #7 Deactivate/reactivate still re-sends every column; a deactivated item keeps its cost
- [ ] #8 Every user-visible string is a message key; zero bare JSX literals; new keys in _fragments/inventory.de.json and .en.json with identical key sets
- [ ] #9 390px screenshot LOOKED AT and attached; 1440px dark screenshot attached
- [ ] #10 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
