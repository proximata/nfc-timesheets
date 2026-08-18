---
id: TASK-177
title: Worker panel hides all three of its cross-links below a ten-row history
status: To Do
assignee: []
created_date: '2026-08-18 18:54'
labels:
  - ux
  - bug
  - a11y
dependencies: []
priority: high
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED with demo/probe-panel-reach.mjs (new, committed with this finding):

  1680x1000  worker panel: 0/3 cross-links reachable without scrolling; first one needs 145px
  390x844    worker panel: 0/3 cross-links reachable without scrolling; first one needs 950px
  1680x1000  building drawer: 6/6 reachable, first already visible
  390x844    building drawer: 6/6 reachable, first already visible

The difference is ordering, nothing else. BuildingFacts puts 'Weiter zu' before its history; WorkerPanel puts it after a ten-card shift list, so on a phone the links sit 1.651px down inside a 767px scroller.

This is defect V1 of the map round (the info box hiding 8 of 8 links) repeated in the drawer, which was never measured. The links themselves are correct and carry their filters (decision-38): 'Alle Schichten dieser Person \u00b7 alle Zeit', the unresolved one, and the close-shift one.

The journey it breaks is the reason decision-28 exists. JOURNEYS.md 2.D5 is the director standing in a stairwell being told 'I could not clock out'; JOURNEYS.md 9 item 4 requires closing a named worker's shift in one action from a worker, on a phone. Today that is one tap plus 950px of scrolling past history the director did not ask for.

FIX: move the 'Weiter zu' block above the shift table in web/components/WorkerPanel.tsx. The building panel already proves the ordering reads well. Do not delete the history and do not truncate it \u2014 it is how a payslip dispute is answered.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 demo/probe-panel-reach.mjs reports at least one cross-link reachable without scrolling for the worker panel at 390x844
- [ ] #2 demo/probe-panel-reach.mjs still reports 6/6 for the building drawer at both viewports (no regression on the surface that was already right)
- [ ] #3 The 'letzten 10 Schichten' table is still present and still complete in the worker panel
- [ ] #4 Focus order matches visual order: tabbing from the facts list reaches the links before the history
- [ ] #5 Journey D5 (JOURNEYS.md 2.D5): from /workers/?worker=<id> on a 390px viewport, the control that closes that person's open shift is reachable without scrolling
- [ ] #6 demo/audit-keyboard.mjs and demo/probe-focus-restore.mjs still pass
<!-- AC:END -->
