---
id: TASK-11
title: 'Server-side cron: auto-finish shifts > 8h'
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-07-28 14:46'
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
- [ ] #1 Shift open >8h auto-closed with autoFinished and needsCorrection true
- [ ] #2 Auto-closed shift excluded from payroll aggregation
- [ ] #3 GET /shifts/unresolved?worker=X returns unresolved shifts
- [ ] #4 Server log records each auto-closure
- [ ] #5 Shift locked: no further events accepted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTATION (decision-16): systemd timer running SQL. NOT pg_cron, NOT setInterval in the API process.

Why: pg_cron on self-hosted Postgres needs the extension installed plus a
shared_preload_libraries change and a DB restart. An in-process setInterval dies whenever the
API process dies - exactly when you least want the safety net gone. A systemd timer is
already available (runbook section 5 establishes systemd), survives API crashes, and is
decoupled from app code.

/etc/systemd/system/nfc-autoclose.timer  -> OnCalendar=*:0/15  (every 15 min)
/etc/systemd/system/nfc-autoclose.service -> ExecStart=/usr/bin/psql -f /srv/nfc/autoclose.sql

autoclose.sql - single idempotent statement, safe to run repeatedly:
  UPDATE shifts
     SET end_time = start_time + INTERVAL '8 hours',
         manual_finish = true,
         needs_correction = true
   WHERE end_time IS NULL
     AND start_time < now() - INTERVAL '8 hours';

Idempotent because the WHERE clause excludes rows it already touched (end_time IS NULL
stops matching). No bookkeeping table needed.

CHECK (required): insert a shift with start_time = now() - 9h and end_time NULL, run the SQL
twice, assert exactly one row updated and the second run updates zero. Trivial to script with
psql; no framework.

decision-10 unchanged - 8h threshold, mandatory worker resolution, manualFinish flag all
stand. Only the scheduling mechanism is specified here.
<!-- SECTION:NOTES:END -->
