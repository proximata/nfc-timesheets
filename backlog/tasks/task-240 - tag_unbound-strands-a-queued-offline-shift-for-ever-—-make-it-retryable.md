---
id: TASK-240
title: tag_unbound strands a queued offline shift for ever — make it retryable
status: Wont Do
assignee: []
created_date: '2026-08-22 12:54'
updated_date: '2026-08-24 17:49'
labels:
  - android
  - payroll
  - reliability
dependencies: []
references:
  - backlog/decisions/decision-47
  - backlog/docs/ZONE-VERIFICATION.md
modified_files:
  - >-
    android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/core/ApiFailure.kt
priority: high
ordinal: 158000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY decision-47's design pass, NOT fixed by it. Same shape as the 401 payroll data-loss bug ApiFailure.kt already documents.

MEASURED CURRENT STATE (read, not argued):
  ApiFailure.isRetryable  -> 'tag_unbound' falls to the default: a 422 is NOT retryable
  SyncPlan.blocksRow(f)   = !f.isRetryable                              -> true
  ShiftSync               -> store.markFailed(clientUuid, key, blocked = true)
  a blocked row is NEVER planned again: nothing clears sync_blocked except
  markOpenSynced / markCloseSynced, and both are unreachable for a row that is
  never planned.
  ShiftStore.startShift writes the LOCAL row BEFORE the sync attempt, so the
  worked hours exist on the phone and are simply never sent.

THE FAILURE: a card is mounted at a door before the office resolves it in /tags/ —
CORE-FLOW.md section 4 step 7 calls that ROUTINE, not rare. A cleaner taps it, works,
and the queued open is refused 422 tag_unbound. The admin resolves the tag an hour
later. The identical bytes would now succeed. Nothing ever retries them. The hours
are lost, and the only sign is a red line in a list.

THE CONSTRAINT THAT MAKES IT NON-OBVIOUS: tag_unbound looks like a payload error
(the id on the card names nothing) and every other 422 in this app genuinely is one.
It is not: it is a temporary state of the SERVER's configuration, exactly like
zone_unverified (decision-47) and exactly like a lapsed session's 401. Retrying is
safe and cannot misfile A's hours under B — SyncPlan blocks a row whose workerId is
not the session's worker as WRONG_ACCOUNT before any step is planned, and that check
is untouched. It cannot spin either: the queue drains only on tap, on pull-to-refresh
and when the log screen appears; there is no background loop.

MUST NOT REGRESS: invalid_code stays TERMINAL (a sign-in code is single-use and
rate-limited — auto-retrying burns the worker's remaining attempts and locks the
phone out at the moment they are trying to get in). No other code's classification
changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ApiFailure('tag_unbound').isRetryable is true and SyncPlan.blocksRow is false for it
- [ ] #2 A queued open refused with tag_unbound is re-planned on the next drain and lands 201 once the tag is resolved — proven end to end against a real server, not by reading the classifier
- [ ] #3 RED case run and shown failing first: with the change reverted, the same scenario leaves the row sync_blocked=1 and the shift never reaches the server
- [ ] #4 invalid_code is still terminal; no other error code's isRetryable changes (asserted, with a RED case)
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 17:49
---
Owner ruling 2026-08-24: still piloting UAT, client highly loyal, data loss at this stage is explicitly not a concern. More importantly — a clock-in against a tag not (yet) resolved in the system SHOULD NOT land; the current 422 tag_unbound refusal is the wanted behaviour, not a bug. Won't-do the retry. Revisit only if/when this moves past pilot and an unresolved-tag refusal starts costing a real worker real, un-recoverable hours.
---
<!-- COMMENTS:END -->
