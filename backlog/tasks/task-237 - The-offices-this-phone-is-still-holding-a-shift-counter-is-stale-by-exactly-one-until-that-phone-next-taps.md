---
id: TASK-237
title: >-
  The office's "this phone is still holding a shift" counter is stale by exactly
  one, until that phone next taps
status: To Do
assignee: []
created_date: '2026-08-21 12:19'
labels:
  - android
  - server
  - admin
  - task-225
dependencies: []
priority: medium
ordinal: 155000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
OBSERVED, not reasoned about, by demo/prove-offline-push.mjs on 2026-08-21 against production:

    server shifts 256, 258   both delivered, both closed
    phone SQLite             EMPTY
    workers.phone_pending_shifts  = 1

The row was in the ledger and the office was still told a phone was holding it.

WHY. net/Api.kt attaches X-Pending-Shifts/-Blocked/-Oldest to EVERY request, and the value
it attaches is the queue as it stood BEFORE that request (ShiftStore.pendingSummary, read
from the in-memory cache at connection setup). So the request that delivers the LAST queued
row reports '1 outstanding', the row commits, and the zero is never sent -- there is no
further request to carry it. The counter self-corrects on the phone's NEXT contact with the
server, i.e. the next tap, which may be tomorrow morning.

COST. A false caveat on money screens: /workers/ says a phone is holding hours, /payroll/
repeats it above the table. It never loses an hour and never affects payroll arithmetic --
the shift is already in the ledger and already counted. What it costs is the credibility of
the caveat itself, which is the one thing that must stay believed.

WHERE. android .../net/Api.kt (attachPending), .../data/ShiftSync.kt (push() returns
store.pendingSummary() and then stops), server/routes/app.js (the X-Pending-* recorder).

SHAPE OF A FIX (not decided). After a drain that empties the queue, make ONE more cheap
request so the zero is carried -- refreshRoster() already exists, is idempotent, already
carries the headers and already fails silently. It must stay off the tap path and must
never be able to block or delay a clock-in.

NEGATIVE CASE ALREADY EXISTS: demo/prove-offline-push.mjs section 9 asks the PHONE first,
then waits 60s for the office's copy, and when the queue is empty and the counter is not it
names this task by number rather than printing a generic failure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After the last queued row is delivered, workers.phone_pending_shifts reaches 0 without the phone tapping again
- [ ] #2 prove-offline-push section 9 passes on the first read, with the 60s wait removed, on two consecutive runs
- [ ] #3 Nothing new runs on the tap path: a clock-in with no signal is not slower and cannot be blocked (measured, not asserted)
- [ ] #4 The extra request is skipped entirely when the drain delivered nothing, so an idle phone still costs no traffic
<!-- AC:END -->
