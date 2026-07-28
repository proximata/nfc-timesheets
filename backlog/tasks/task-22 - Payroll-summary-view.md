---
id: TASK-22
title: Payroll summary view
status: To Do
assignee: []
created_date: '2026-07-28 13:50'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-20
  - TASK-18
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per worker: hours x hourly rate = payroll amount. Period selector (5 periods). Read-only aggregation. Excludes needsCorrection shifts with visible warning count. Respects rate effective_from dates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each worker row: name, hours, rate, gross pay
- [ ] #2 Total row at bottom
- [ ] #3 Period selector works
- [ ] #4 needsCorrection shifts excluded with visible count
- [ ] #5 Correct rate per shift based on effective_from
<!-- AC:END -->
