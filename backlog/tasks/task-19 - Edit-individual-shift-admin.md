---
id: TASK-19
title: Edit individual shift (admin)
status: Done
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-04 16:48'
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
TRIAGE 2026-08-04 — DONE.

Live routes, both registered (401 unauthenticated, not 404):
  POST  /admin/shifts       — create a shift by hand (the phone-died case)
  PATCH /admin/shifts/:id   — edit one
server/routes/admin.js:1292-1293. A hand-created shift has client_uuid NULL, which is exactly how
the reporting layer tells a phone-originated shift from an office-entered one
(server/db/README.md:141).

This route is also the only remaining fallback for an unreadable tag, since the in-app manual
scanner was removed (TASK-9 AC3). Worth knowing when a worker calls.

Frame: `docs/media/admin-shifts.png`.
<!-- SECTION:NOTES:END -->
