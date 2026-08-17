---
id: TASK-141
title: 'Redesign /shifts/: read-only log, two drawers, filters stay client-side'
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
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Frage: „Welche Schichten brauchen eine Entscheidung?"

Batch B1 (REDESIGN-PLAN.md section 4.2). Inventory section 2: 943 lines, ns shifts, 84 keys, 12 inputs. Class MIXED, the hardest one - a read-only log carrying TWO permanently-open forms (create by hand, correct a shift) plus three filters.

Both forms move into Drawers with one job each; the log becomes read-only and calm. Nothing else about this screen changes shape.

THE TRAP: fetchShiftSnapshot deliberately fetches /admin/data UNBOUNDED and filters in the browser. A server-bounded fetch cannot say „nichts im August - 5 Schichten liegen in früheren Zeiträumen", and that distinction was the difference between „fine" and „our payroll data is gone". If filtering moves to the server, outsideCount and emptyOutside become unimplementable. Do not move it.

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
- [ ] #1 Both permanently-open forms (create by hand, correct a shift) are gone from the page body; each is a Drawer with exactly one job, opened by an explicit control
- [ ] #2 PageHeader renders the h1 and the German question „Welche Schichten brauchen eine Entscheidung?" from REDESIGN-PLAN.md section 4.4
- [ ] #3 Filtering is still CLIENT-SIDE over the unbounded payload: fetchShiftSnapshot is called with no from/to. Proven by selecting a period with no rows and seeing outsideCount and latestRecorded still reported
- [ ] #4 The three sentences that stop „empty" reading as „gone" all still render: truncated {limit}, outsideCount, and emptyOutside {count} + latestRecorded {date} with BOTH escape buttons showAll and jumpToLatest {period}
- [ ] #5 The result-count line is still ONE sentence in role=status, and noneBlocked is still suppressed when the table is empty (a claim about nothing)
- [ ] #6 All four domain states still render as WORDS with payable / notPayable beside them: open, unresolved, resolved, complete; .row-attention still marks open and unresolved rows
- [ ] #7 The colOrigin column survives: client_uuid IS NULL still renders originManual - it is the only record that a human typed a row, and payroll gets audited
- [ ] #8 createManualNotice still renders BEFORE the create form, correctUnresolvedNotice still renders when correcting an unresolved shift, and timeZoneHint still appears under both forms and on the filter bar
- [ ] #9 Inactive workers and locations are still listed in the edit selects, wrapped in inactiveOption {name}
- [ ] #10 All eight field-level error keys still fire on their own field (errorStartRequired, errorStartInvalid, errorEndRequired, errorEndInvalid, errorEndBeforeStart, errorFuture, errorWorkerRequired, errorLocationRequired), plus errorOverlap, errorOverlapUnknown, errorGone, errorRejected, errorCreateRejected
- [ ] #11 Save result messages render on the PAGE aria-live region, never inside the drawer that closes on success
- [ ] #12 Keyboard only: resolve an unresolved shift from its drawer so the row leaves the list; focus lands in the list or on #main-content and never on <body>
- [ ] #13 390px screenshot LOOKED AT and attached - no horizontal page scroll, card captions match the correct columns; 1440px dark screenshot attached
- [ ] #14 de.json, en.json, globals.css, lib/nav.ts and components/* untouched; cd web && pnpm lint && pnpm typecheck green
<!-- AC:END -->
