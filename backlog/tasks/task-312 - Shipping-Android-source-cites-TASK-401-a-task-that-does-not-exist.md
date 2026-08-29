---
id: TASK-312
title: 'Shipping Android source cites TASK-401, a task that does not exist'
status: To Do
assignee: []
created_date: '2026-08-29 11:21'
labels:
  - docs
  - android
dependencies: []
ordinal: 230000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the review gate.

git diff origin/main HEAD | grep -o 'TASK-[0-9]*' -> TASK-401 appears in:
  net/OperatorSession.kt
  TimeSheetsApplication.kt
  nfc/VerifyZoneActivity.kt
  nfc/WriteTagActivity.kt
  checks/core-check.kt
  and the commit message of 75fd766

The board's highest task before this run was 308. TASK-401 was invented. Anyone following
the reference to understand why the operator 401 recovery exists finds nothing.

Same class of mistake, already corrected: RawTagIo.kt cited TASK-311, which also did not
exist. TASK-311 has now been written to match what that code says, so that one resolves.
TASK-401 cannot be fixed the same way without opening a 400-block in the numbering.

FIX: create the real record for the operator-401 recovery work, then update the six
references to its number. Comment-only edit - reverting it changes nothing a user sees - so
it is safe to do as documentation work, but it does touch app source, so do it as its own
commit with an explicit path list and never a broad add.

The WORK ITSELF is correct and was independently verified by the review gate:
Api.send()'s single choke point fires onSessionRejected on any 401 of a session-bearing
request, so every operator call site is covered by construction rather than one at a time;
sessionBearing=false on /auth/operator-code and the sms request/verify routes keeps a wrong
CODE from signing anybody out; OperatorSession.reject() clears the cookie jar and the zone
cache and latches a StateFlow that both open screens collect; the worker session is
untouched in both directions. checks/operator-401-check.kt drives it over a real loopback
HTTPS server against the real shipping Api.kt and passes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a real task records the operator-401 recovery
- [ ] #2 the six TASK-401 references point at it
<!-- AC:END -->
