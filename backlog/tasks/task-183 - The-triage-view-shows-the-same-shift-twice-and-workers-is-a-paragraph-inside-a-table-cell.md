---
id: TASK-183
title: >-
  The triage view shows the same shift twice, and /workers/ is a paragraph
  inside a table cell
status: To Do
assignee: []
created_date: '2026-08-18 18:56'
labels:
  - ux
dependencies: []
priority: low
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two typesetting faults with the same cause: a block designed for the unfiltered screen is still rendered when the filter has already done its job.

1. /shifts/?state=unresolved&period=all renders the 'ZU ENTSCHEIDEN' band AND the SCHICHTPROTOKOLL table with the identical row, and both answer cells read '1'. Evidence: docs/media/states/shifts-unresolved-1680-light.png \u2014 one shift, shown twice, under two cells that say the same number, after a filter bar that repeats 'Angezeigt werden alle geladenen Schichten' a second time. This is the target of the dashboard's most-used link (JOURNEYS.md 2.D5, 2.W8, 1-2 per week).
   FIX: suppress the band when the active filter IS the band's own predicate.

2. /workers/ at 1680px puts eight columns in the content width and one of them holds a full sentence: 'Kein Stundensatz \u2013 in der Lohnabrechnung namentlich ausgenommen, nicht mit 0,00 EUR bewertet'. Every cell in the row wraps to three lines and the row is ~100px tall. demo/shoot-ia.mjs's wrapped-word count is 86, the highest of any screen in the product. Evidence: workers-1680-dark.png.
   FIX: the sentence moves out of the cell. The CELL says 'Kein Stundensatz'; the sentence goes once above the table, or into the worker's own panel where there is room for it. The truth stays on the screen, it just stops being repeated per row.

DO NOT delete either sentence. The rate-less exclusion must remain visible on this surface (it is one of the eight).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On /shifts/?state=unresolved, no shift appears in both the 'Zu entscheiden' band and the table
- [ ] #2 On /shifts/ with no state filter, the 'Zu entscheiden' band still appears with every open and unconfirmed shift
- [ ] #3 The /workers/ rate column cell holds a short phrase; the full 'namentlich ausgenommen, nicht mit 0,00 EUR bewertet' sentence appears once per screen, not once per row
- [ ] #4 demo/shoot-ia.mjs reports a lower wrapped-word count for workers-1680-dark than the current 86
- [ ] #5 No control on either screen loses a label and no truth listed in REDESIGN-INVENTORY.md 2 or 4 is deleted
- [ ] #6 Journey W8 + D5 (JOURNEYS.md 1.W8, 2.D5): the shift that needs a decision is on screen once, with its Korrigieren control
- [ ] #7 Journey D3 + D11 (JOURNEYS.md 2.D3, 2.D11): the worker list can be read down a phone line without horizontal scanning
<!-- AC:END -->
