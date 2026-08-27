---
id: TASK-19
title: Edit individual shift (admin)
status: Done
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-27 07:31'
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
- [x] #1 Edit modal pre-fills current values
- [x] #2 Validation: end > start, reasonable bounds
- [x] #3 Save persists to Postgres
- [x] #4 Audit trail stored
- [ ] #5 Edited shift flagged manualFinish=true
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC5 (manualFinish=true flag) is dead by design, not a gap - decision-10 replaced the single manual_finish column with two independent facts (auto_closed + corrected_at); server/db/check-migrate.js:138-140 asserts the old column must be GONE from the schema. Left unchecked deliberately.
<!-- SECTION:NOTES:END -->
