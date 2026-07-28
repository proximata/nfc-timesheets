---
id: TASK-20
title: Workers CRUD + hourly rates
status: To Do
assignee: []
created_date: '2026-07-28 13:50'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-15
  - TASK-2
priority: high
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Workers management page. List with current hourly rate. Add/remove workers. Set/update hourly rate per worker with effective_from date for history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Add worker with name + hourly rate
- [ ] #2 Edit hourly rate preserves old rate with date range
- [ ] #3 Remove worker (warn if shifts exist)
- [ ] #4 Rate history queryable for payroll at correct rate
<!-- AC:END -->
