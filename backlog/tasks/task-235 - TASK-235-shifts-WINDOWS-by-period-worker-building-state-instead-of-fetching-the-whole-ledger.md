---
id: TASK-235
title: >-
  TASK-235: /shifts/ WINDOWS by period/worker/building/state instead of fetching
  the whole ledger
status: To Do
assignee: []
created_date: '2026-08-21 07:55'
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
- [ ] #1 GET /admin/data accepts optional ?worker=&location=&state=, applied to the shift row query
- [ ] #2 shift_outside_count is returned and equals shiftMatchingTotal - shiftMatchingInRange
- [ ] #3 the shift log refetches on period/worker/location/state change, mirrors fetchPayrollSnapshot
- [ ] #4 the 2000-row ceiling is proven true at 1999 (not truncated), 2000 and 2001 (truncated) rows for one isolated worker+location+period, negative case shown RED first
- [ ] #5 shift_outside_count stays 0 at the truncation boundary -- truncation and 'outside the period' are never conflated
- [ ] #6 server/check-api.js passes; web pnpm check/tsc/build pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and deployed to nothing yet (local only pending deploy step). Commit cf9e102. Windowing chosen over pagination: the period filter already lives in web/lib/filters.ts and every cross-link already carries it (decision-38), so no second mechanism was invented.
<!-- SECTION:NOTES:END -->
