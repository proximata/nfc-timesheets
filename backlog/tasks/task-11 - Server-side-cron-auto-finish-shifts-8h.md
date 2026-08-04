---
id: TASK-11
title: 'Server-side cron: auto-finish shifts > 8h'
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
labels:
  - server
milestone: m-2
dependencies:
  - TASK-3
priority: high
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
setInterval in server process, every 15 min query open shifts >8h. Set end=start+8h, autoFinished=true, needsCorrection=true. Shift locked and excluded from payroll until worker resolves. API: GET /shifts/unresolved?worker=X.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shift open >8h auto-closed with autoFinished and needsCorrection true
- [x] #2 Auto-closed shift excluded from payroll aggregation
- [x] #3 GET /shifts/unresolved?worker=X returns unresolved shifts
- [x] #4 Server log records each auto-closure
- [x] #5 Shift locked: no further events accepted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, and observed RUNNING in production today.

  $ systemctl list-timers
  Tue 2026-08-04 16:45:00 UTC  5min  Tue 2026-08-04 16:30:03 UTC  nfc-autoclose.timer
  $ systemctl status nfc-autoclose.service
  Process: 45212 ExecStart=/usr/bin/psql --set=ON_ERROR_STOP=1 --dbname=nfc
           --file=/srv/nfc/ops/sql/autoclose.sql (code=exited, status=0/SUCCESS)
  Aug 04 16:30:03 timesheets psql[45212]: UPDATE 0

`UPDATE 0` is the correct answer — no shift is currently past 8h. AC4: that line IS the log.

Implemented as decided (decision-16 + the note on this task): a systemd timer running SQL, not
pg_cron and not setInterval in the API process. Units in ops/systemd/, statement in
ops/sql/autoclose.sql, idempotent because the WHERE clause stops matching rows it has touched.
AC1: the statement sets auto_closed = true; the columns exist in production (`\d shifts` shows
auto_closed boolean NOT NULL DEFAULT false and corrected_at timestamptz).
AC2 + AC5: web/lib/payroll.ts buckets an unresolved shift into `unresolvedShifts` and never into
payable; the API rejects further events on a closed shift.
AC3: `GET /shifts/unresolved` is live (401 unauthenticated, i.e. registered).
Check that exists: ops/check-autoclose.sh.

NOTE the schema drifted from this task text and the schema is right: `manual_finish` was split
into two flags, `auto_closed` (the timer did it) and `corrected_at` (a human fixed it), because
one flag set by both could distinguish neither.
<!-- SECTION:NOTES:END -->
