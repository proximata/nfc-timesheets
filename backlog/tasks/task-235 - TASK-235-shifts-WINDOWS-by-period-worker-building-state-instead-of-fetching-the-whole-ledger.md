---
id: TASK-235
title: >-
  TASK-235: /shifts/ WINDOWS by period/worker/building/state instead of fetching
  the whole ledger
status: Done
assignee: []
created_date: '2026-08-21 07:55'
updated_date: '2026-08-21 08:21'
labels:
  - scale
  - shifts
  - server
  - web
dependencies: []
priority: high
ordinal: 153000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second-client scale pass. /shifts/ fetched every row up to shift_limit=2000 UNBOUNDED BY DATE and filtered worker/location/state/period in the browser -- 39.7 phone screens at 351 seeded shifts, and a thisYear view at 20 workers/8 buildings (~5000-10000 shifts) would exceed the cap while the query itself was not even bounded by time, so the newest 2000 rows site-wide could silently exclude January. Fixed by WINDOWING: GET /admin/data now accepts optional worker/location/state alongside the existing from/to (the pattern /payroll/ already proved), and two new indexed COUNT aggregates give shift_outside_count so the client no longer needs to hold the whole ledger to say 'no rows in this period vs no rows anywhere'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /admin/data accepts optional ?worker=&location=&state=, applied to the shift row query
- [x] #2 shift_outside_count is returned and equals shiftMatchingTotal - shiftMatchingInRange
- [x] #3 the shift log refetches on period/worker/location/state change, mirrors fetchPayrollSnapshot
- [x] #4 the 2000-row ceiling is proven true at 1999 (not truncated), 2000 and 2001 (truncated) rows for one isolated worker+location+period, negative case shown RED first
- [x] #5 shift_outside_count stays 0 at the truncation boundary -- truncation and 'outside the period' are never conflated
- [x] #6 server/check-api.js passes; web pnpm check/tsc/build pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and deployed to nothing yet (local only pending deploy step). Commit cf9e102. Windowing chosen over pagination: the period filter already lives in web/lib/filters.ts and every cross-link already carries it (decision-38), so no second mechanism was invented.

Measured against a grown nfc_demo (8 buildings/20 workers/2862 shifts, backlog/docs/SCALE-PROOF.md section 1-3): the OLD unbounded fetch returns 0 of 410 real March rows (oldest row in its 2000-cap window is 6 April); the NEW windowed fetch returns all 410, untruncated, shift_outside_count=2452. Boundary proven at real volume too: thisYear = 2862 matching rows, truncated=true, shift_outside_count=0 (every row IS inside the period; the cap just bit -- never conflated with 'outside').
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GET /admin/data windowed by worker/location/state alongside the existing from/to; two new indexed COUNT aggregates produce shift_outside_count. web/app/shifts/page.tsx refetches on filter change, mirrors fetchPayrollSnapshot; the old client-side matching/stateFiltered/visible pipeline is gone. Proven at the real 2000-row ceiling (1999 not truncated, 2000/2001 truncated, shift_outside_count stays 0 throughout) and at real seeded volume (March silently empty under the old design, correct under the new one). server/check-api.js PASS (new cases: worker/location narrowing, state filter incl. unsupported-state 400, shift_outside_count, all-or-nothing batch semantics is N/A here -- that's TASK-236 -- the 1999/2000/2001 boundary). web pnpm check/tsc/build PASS. Commits cf9e102, f444702.
<!-- SECTION:FINAL_SUMMARY:END -->
