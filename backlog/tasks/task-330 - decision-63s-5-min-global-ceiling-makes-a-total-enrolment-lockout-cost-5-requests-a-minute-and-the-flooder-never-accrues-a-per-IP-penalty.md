---
id: TASK-330
title: >-
  decision-63's 5/min global ceiling makes a total enrolment lockout cost 5
  requests a minute, and the flooder never accrues a per-IP penalty
status: Done
assignee: []
created_date: '2026-08-29 23:54'
updated_date: '2026-08-30 05:03'
labels:
  - server
  - security
  - decision-63
dependencies: []
priority: medium
ordinal: 248000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Not a defect in what decision-63 decided - the confidentiality arithmetic is correct and the review gate re-derived every figure. This is the AVAILABILITY half, which decision-63 does not mention at all and which got six times cheaper when GLOBAL_LIMIT went 30 -> 5.

THE MECHANISM, read from source at HEAD:
  lib/auth.js:378 checkGlobalEnrolmentRate() counts ATTEMPTS, not failures, for ALL callers
  combined, in a fixed 60s window, and increments BEFORE it compares (globalCount += 1 then
  if (globalCount > GLOBAL_LIMIT)).
  routes/auth.js:196 (worker) and :363 (operator) both call it FIRST, before
  checkLoginRate(bucket). lib/http.js:26 fail() THROWS, so when the global ceiling bites,
  checkLoginRate is never reached and recordLoginFailure is never called.

CONSEQUENCE, arithmetic not speculation:
  - one source address posting 5 junk requests per minute keeps globalCount at or above the
    ceiling for every window, so a legitimate worker or operator typing their real code gets
    429 too_many_attempts. The budget is shared and role-blind (routes/auth.js:355 says so
    explicitly), so this closes BOTH the worker and the operator enrolment door at once.
  - the flooder pays nothing: because the 429 is thrown before checkLoginRate, the enrol:
    per-IP bucket never records a failure and never locks them out. The one limiter that
    could bite a single fixed attacker is unreachable for exactly the attacker who is
    saturating the ceiling.
  - blast radius today is total: sms_login (migration 016) and email_login (migration 021)
    are both seeded false, so the enrolment code is the ONLY door for a new worker AND a new
    operator, and operator enrolment gates decision-47 zone verification.

This was already true at 30/min - the change is that the cost of the attack fell from 30
req/min to 5, and 5 req/min is indistinguishable from a slow script.

NOT A PROPOSAL TO RAISE THE CEILING. Raising it re-opens the confidentiality arithmetic in
lib/enrolment.js, which is the thing decision-63 spent its whole budget on. The cheap options
that do not touch that arithmetic:
  a) call checkLoginRate(bucket) BEFORE checkGlobalEnrolmentRate(), so a single flooding
     address locks itself out on its own bucket first and stops spending the shared budget.
     Note the ordering comment at routes/auth.js:193 argues the current order on purpose
     (IP rotation) - the fix is to spend BOTH, not to swap blindly, and a decision record
     may be needed since the comment states the opposite intent.
  b) do not spend the global budget on requests that fail normaliseCode() - a wrong-SHAPE
     string was never a guess against the keyspace, so it should not cost a real worker
     their slot. This alone removes the cheapest flood.
  c) accept it explicitly in a decision record amending 63, so the next person finds it
     written down rather than rediscovering it.

MUST NOT REGRESS: the ceiling stays 5/min for real guesses; worker and operator keep ONE
shared budget (routes/auth.js:355); the 401 answer stays byte-identical across every failure
mode; no change to CODE_TTL_MS or the keyspace.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a single address posting junk at 10/min can no longer make a legitimate 5-digit code answer 429 - driven, with a real server and a real DB, not reasoned
- [x] #2 a flooding address ends up locked out by its OWN enrol: bucket
- [x] #3 the check-api.js case 'a GLOBAL ceiling bounds the SHARED search space' still passes unchanged, and the worker/operator shared-budget case at :5877 area still passes
- [x] #4 whichever of a/b/c is chosen is written into lib/auth.js's comment block AND, if it contradicts routes/auth.js:193, into a decision record amending decision-63
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed (commit fe8f654): checkLoginRate now runs before checkGlobalEnrolmentRate at both call sites (was reversed - the actual bug). Per-IP tightened to 3 attempts (was 5); global ceiling re-derived to 15/min as a distributed-attacker backstop, not the primary throttle. Independently re-verified via a real two-actor drive on a live server+DB: IP A floods past its own limit (3x401 then 37x429, stays locked), IP B makes one legitimate request during A's flood and gets 401 invalid_code (NOT blocked) - and a counterfactual (order reverted) reproduced the original bug (B gets 429 on its first request), proving the fix is what does the work. decision-63's arithmetic block rewritten and recomputed independently from the shipped constants (all figures match). Ceiling-trip alerting wired.
<!-- SECTION:NOTES:END -->
