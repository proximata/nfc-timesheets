---
id: TASK-269
title: >-
  check-filters.mjs asserts a filtered /shifts/ shows FEWER rows - a fixed
  50-row page makes that unsatisfiable
status: Done
assignee: []
created_date: '2026-08-25 14:23'
updated_date: '2026-08-25 15:49'
labels:
  - checks
dependencies:
  - TASK-18
priority: high
ordinal: 187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
demo/check-filters.mjs FAILS at HEAD, and the failure is a stale assertion, not a broken filter.

MEASURED 2026-08-25 against nfc_demo (348 real shifts) on a fresh 'pnpm build':

    FAIL /shifts/?location= arrives FILTERED, not merely at /shifts/ - 50 of 50 rows

The assertion (demo/check-filters.mjs, ~line 216) is:

    shiftsHere > 0 && shiftsHere < allShifts

where allShifts is the row count of unfiltered /shifts/?period=all. Before TASK-18 that was
348 rows against 71 for the filtered building, so it passed. TASK-18 fixed the page at
SHIFT_PAGE_SIZE = 50, so BOTH counts are now 50 and '50 < 50' can never be true - for any
building with 50 or more shifts in the period.

THE FILTER IS FINE. The four assertions immediately after it all pass on the same page load:
'every visible row really is that building' (1 distinct building), 'the filter is visible as
a chip naming the building', 'removing the chip restores every row', 'removing the chip takes
the parameter out of the URL too'. Independently confirmed in a browser: /shifts/ with that
building and period=all pages 71 rows as 'Seite 2 von 2', 50 + 21.

FIX: count the WINDOW, not the page. The server now answers shift_matching_count, and the
screen prints it as 'Angezeigt {shown} von {total}'. Compare that, or compare the pager's
page count, instead of tbody tr length. Whatever replaces it must still fail when the filter
is genuinely ignored - assert the distinct-building set as well, not only a number.

Effort: low. One assertion, one file. No server or web change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 demo/check-filters.mjs passes end to end against nfc_demo on a fresh web build, with zero FAIL lines
- [x] #2 The replacement assertion still goes RED when the location filter is removed from the fetch - shown red once before being made green
- [x] #3 No change to server/ or web/ - this is a check-only fix
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED 2026-08-25. Root cause confirmed exactly as filed: SHIFT_PAGE_SIZE=50 (TASK-18) caps visible tbody rows, so a filtered and unfiltered /shifts/ read identically once either has >=50 matches.

FIX: added matchingTotal(page), reads the AnswerBand's server-computed 'shown X of Y' cell
(shift_matching_count) instead of counting tbody rows. Locale-agnostic (regex takes the
trailing number, works for both 'X von Y' and 'X of Y').

Fixed BOTH assertions with this exact blind spot, not just the flagged one: 'arrives FILTERED'
(the one in the task title) AND 'removing the chip restores every row' 20 lines later, which
had the identical coverage gap for the same reason (a stuck filter and a correct removal both
read 50/50 on this building) - found while fixing the first, same root cause, same file, kept
in scope.

AC1: node demo/check-filters.mjs -> PASS, 0 failures, against nfc_demo (348 real shifts),
fresh pnpm build. Real building now reads '71 of 348' / '83 of 348' etc, not '50 of 50'.
AC2: shown red on a real mutant first - temporarily dropped &location= from the nav (filter
genuinely ignored), reran: 4 assertions correctly FAILed including the fixed one
('348 of 348 matching'), reverted via file backup, reran clean. Not reasoned, demonstrated.
AC3: git diff --stat demo/check-filters.mjs only; no server/ or web/ change.

Killed a 2-day-old orphaned demo-server on :8092 first (TASK-210's exact documented gotcha)
and started a fresh one against the just-deployed build before running anything.
<!-- SECTION:NOTES:END -->
