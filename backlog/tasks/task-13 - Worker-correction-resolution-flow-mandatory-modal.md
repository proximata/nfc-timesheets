---
id: TASK-13
title: Worker correction resolution flow (mandatory modal)
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
labels:
  - ios
  - ux
milestone: m-2
dependencies:
  - TASK-11
priority: high
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On app launch, fetch GET /shifts/unresolved?worker=X. If unresolved shifts exist, show modal sequence one-by-one (not dismissable). Each card: location, start time, auto-finish label, date picker for real end. Motivation: wont count toward payroll. Progress indicator (1 of 3). After all resolved, normal app. Corrected shifts: manualFinish=true, needsCorrection=false, color-coded in admin.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App launch blocked by resolution modal if unresolved shifts exist
- [ ] #2 Shifts presented one-by-one with clear context
- [ ] #3 Worker must set real end time, no skip/dismiss
- [ ] #4 Motivational text references payroll exclusion
- [ ] #5 After correction: needsCorrection=false, manualFinish=true
- [ ] #6 Corrected shift included in payroll aggregation
- [ ] #7 Progress indicator for multiple shifts
<!-- AC:END -->
