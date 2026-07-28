---
id: TASK-19
title: Edit individual shift (admin)
status: To Do
assignee: []
created_date: '2026-07-28 13:50'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-18
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Click shift row -> edit modal. Change start/end time. Audit logged (who, when, old value). Rarely used for corrections. Re-flags as manualFinish.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Edit modal pre-fills current values
- [ ] #2 Validation: end > start, reasonable bounds
- [ ] #3 Save persists to Postgres
- [ ] #4 Audit trail stored
- [ ] #5 Edited shift flagged manualFinish=true
<!-- AC:END -->
