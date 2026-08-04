---
id: TASK-18
title: Shifts table view with filters + color coding
status: In Progress
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-04 16:49'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-15
  - TASK-3
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Table: worker, building, date, start, end, duration, status. Filters: worker, building, date range, status. Server-side pagination 50/page. Joined view (names not IDs). manualFinish=amber row, needsCorrection=orange row. URL-persisted filters.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All shifts visible with human-readable names
- [ ] #2 Filters narrow results, URL-persisted
- [ ] #3 Pagination works with >100 shifts
- [x] #4 Color coding visible at a glance
- [ ] #5 Sorting by any column
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — SHIPPED BUT INCOMPLETE. Live and useful; three of five criteria unmet.

MET. `curl https://timesheets.exe.xyz/shifts/` -> 200 (web/app/shifts/page.tsx).
AC1: joined names, not ids. AC4: colour coding, and never colour ALONE — an auto-closed shift is
also labelled in words. Worker/building/period filters work. Frame: docs/media/admin-shifts.png.

NOT MET, and it is one defect wearing three hats — the screen pulls the WHOLE table:
  web/app/shifts/page.tsx:54  "Filtering and sorting happen in the browser over the single
                               UNBOUNDED /admin/data"
- AC3 no pagination. Every shift ever recorded is fetched, parsed and held in the browser on
  every visit. Fine at 5 rows (production has 5). At 20 cleaners x ~1 shift/day this is ~7000
  rows/year in memory and growing without bound.
- AC2 filters are React state, NOT in the URL. A filtered view cannot be linked or bookmarked,
  and the back button does not restore it.
- AC5 sort is fixed at start_time DESC (page.tsx:242). No column is sortable.

CONSEQUENCE if never done: the screen gets slower every month and eventually stops loading; the
office cannot send anyone a link to a specific view. Nothing is lost or mispaid. Not urgent while
the table is small, but it is on the payroll path, so it should not be left until it breaks.
LOW-MEDIUM effort: server-side LIMIT/OFFSET on /admin/data plus URL search params.
<!-- SECTION:NOTES:END -->
