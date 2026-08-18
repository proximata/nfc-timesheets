---
id: TASK-177
title: Worker panel hides all three of its cross-links below a ten-row history
status: Done
assignee: []
created_date: '2026-08-18 18:54'
updated_date: '2026-08-18 21:58'
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
- [x] #1 demo/probe-panel-reach.mjs reports at least one cross-link reachable without scrolling for the worker panel at 390x844
- [x] #2 demo/probe-panel-reach.mjs still reports 6/6 for the building drawer at both viewports (no regression on the surface that was already right)
- [x] #3 The 'letzten 10 Schichten' table is still present and still complete in the worker panel
- [x] #4 Focus order matches visual order: tabbing from the facts list reaches the links before the history
- [x] #5 Journey D5 (JOURNEYS.md 2.D5): from /workers/?worker=<id> on a 390px viewport, the control that closes that person's open shift is reachable without scrolling
- [x] #6 demo/audit-keyboard.mjs and demo/probe-focus-restore.mjs still pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE in a003674, verified independently on a fresh build 2026-08-18 (rebuilt web/out with the Maps key, served by demo/demo-server.mjs on nfc_demo, read off the rendered screen at 1680x1000 and 390x844, dark and light).

WHAT MOVED. web/components/WorkerPanel.tsx and web/app/analytics/page.tsx: the 'Weiter zu' list is now printed before the history / trend table. Nothing was deleted or truncated - the ten shift cards and the twelve trend rows are still complete, they are simply second.

MEASURED AFTER (demo/check-reach.mjs, geometry inside the SCROLLER's rectangle, offsetParent required):
  worker panel      1680  3/3, first link y=267 of a 923px scroller   (was 0/3, +145px)
  worker panel       390  3/3, first link y=312 of a 767px scroller   (was 0/3, +950px)
  analytics drawer  1680  4/4 first                                    (was under a 12-row table)
  analytics drawer   390  4/4                                          (was 0/4)
  building drawer   1680  6/6   unchanged and now asserted
  building drawer    390  6/6   unchanged and now asserted
  info box (pin)    1680  0/10 on screen, 10/10 one press away - the disclosure is the target
  info box (pin)     390  renders as the drawer, 5/10 on screen

AC#4 focus order: asserted at all four configurations ('focus order matches visual order - links before the history'), and it is one of the six assertions that go red on the pre-fix tree.
AC#6: demo/audit-keyboard.mjs 13/13 and demo/probe-focus-restore.mjs green on this build (AUDIT_BASE must be pointed at the running server; the audits default to :8082).

NEGATIVE CASE PROVEN INDEPENDENTLY, not taken on trust: web/ reverted to c41d33f, rebuilt, same check run -> 76 FAIL (/tmp/reach/RED-mutant.log), of which 12 are this task's. Fixed tree: 224 ok, 0 FAIL (/tmp/reach/GREEN-verify.log).

THE FIFTH LIST. The probe's 'complete set of four panels' claim was checked, not believed: /pl/ prints a fifth ul.panel-links inside every flagged building's callout. Measured on a 99,90 % baseline (removed again afterwards): 1680 first link y=823, 3 of 4 on the first screen; 390 first link y=1269, one ordinary page scroll down; all four are 44px targets carrying ?location= and the period. It is document flow, not a panel with its own overflow, so it cannot trap a link the way the four above could. The measurement and that argument are now in the header of demo/probe-panel-reach.mjs so the next reader does not re-derive it.

nfc_demo: dumped before the run, row-count fingerprinted after, every table identical.
<!-- SECTION:NOTES:END -->
