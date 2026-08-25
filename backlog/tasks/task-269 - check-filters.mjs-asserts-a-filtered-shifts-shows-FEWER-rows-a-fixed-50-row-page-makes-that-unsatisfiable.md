---
id: TASK-269
title: >-
  check-filters.mjs asserts a filtered /shifts/ shows FEWER rows - a fixed
  50-row page makes that unsatisfiable
status: To Do
assignee: []
created_date: '2026-08-25 14:23'
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
- [ ] #1 demo/check-filters.mjs passes end to end against nfc_demo on a fresh web build, with zero FAIL lines
- [ ] #2 The replacement assertion still goes RED when the location filter is removed from the fetch - shown red once before being made green
- [ ] #3 No change to server/ or web/ - this is a check-only fix
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found by the TASK-18 verification pass, not by the implementing run: that run ran pnpm check/lint/typecheck/build and server/check-api.js, none of which drives a browser.
<!-- SECTION:NOTES:END -->
