---
id: TASK-13
title: Worker correction resolution flow (mandatory modal)
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:48'
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
- [x] #1 App launch blocked by resolution modal if unresolved shifts exist
- [x] #2 Shifts presented one-by-one with clear context
- [x] #3 Worker must set real end time, no skip/dismiss
- [x] #4 Motivational text references payroll exclusion
- [x] #5 After correction: needsCorrection=false, manualFinish=true
- [x] #6 Corrected shift included in payroll aggregation
- [x] #7 Progress indicator for multiple shifts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE.

- API: `GET /shifts/unresolved` and `POST /shifts/:id/resolve` are both registered live (401
  unauthenticated, vs 404 for an unknown path).
- iOS: ContentView.swift holds `@State private var unresolved: [WireShift]`, `ResolveSheet`, and
  `let mustResolve = !unresolved.isEmpty`. AC1/AC3: the sheet is forced, not dismissible.
  AC7: `unresolvedCount:` is passed through for the progress indicator.
- AC4: shipped copy — "Diese Schicht hat 8 Stunden überschritten und wurde automatisch beendet.
  Sie wird erst bezahlt, wenn Sie bestätigen, wann Sie tatsächlich fertig waren."
- AC5/AC6: resolution stamps `corrected_at`; web/lib/payroll.ts then counts the shift as payable.
  server/check-api.js:1765-1773 asserts the round-trip preserves the corrected timestamp.

One ordering bug was already found and fixed here and is worth keeping: the record-first,
then-resolve order (ContentView.swift ~431) exists because a worker at the door at 06:02 was
being made to resolve a three-day-old shift BEFORE their current tap was recorded. The tap is
recorded first now, and an unresolved shift still always opens the resolver — including on the
tap that just created one.
<!-- SECTION:NOTES:END -->
