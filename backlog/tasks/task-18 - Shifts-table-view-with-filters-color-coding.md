---
id: TASK-18
title: Shifts table view with filters + color coding
status: To Do
assignee: []
created_date: '2026-07-28 13:50'
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
- [ ] #1 All shifts visible with human-readable names
- [ ] #2 Filters narrow results, URL-persisted
- [ ] #3 Pagination works with >100 shifts
- [ ] #4 Color coding visible at a glance
- [ ] #5 Sorting by any column
<!-- AC:END -->
