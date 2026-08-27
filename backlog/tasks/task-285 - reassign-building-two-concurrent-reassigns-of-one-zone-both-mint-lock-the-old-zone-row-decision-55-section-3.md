---
id: TASK-285
title: >-
  reassign-building: two concurrent reassigns of one zone both mint - lock the
  old zone row (decision-55 section 3)
status: Done
assignee: []
created_date: '2026-08-27 06:47'
updated_date: '2026-08-27 07:14'
labels:
  - server
  - operator
  - decision-55
dependencies: []
priority: medium
ordinal: 203000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PRE-EXISTING IN THE decision-55 ROLLOUT, found by TASK-284 (review gate) reading the CTE and then racing it for real. NOT a partial application and NOT a violation of decision-55 section 3 as written - each statement is internally whole, the door never loses its zone, no written tag is discarded. It is a second, unanticipated outcome: ONE door ends up with TWO live zones in TWO buildings.

MEASURED, two overlapping connections against a real Postgres, the exact statement from server/routes/operator.js:558-576:

  A minted: bbbbbbbb-...-0003 -> building NEU,   retired_zone_id aaaaaaaa-...-0001
  B minted: bbbbbbbb-...-0004 -> building DRITT, retired_zone_id aaaaaaaa-...-0001
  final rows: aaaaaaaa-...-0001 active=false | bbbb-0003 active=true (NEU) | bbbb-0004 active=true (DRITT)

WHY: the old CTE (operator.js:559-561) is a PLAIN SELECT, so both statements see the zone live+bound in their own READ COMMITTED snapshots. The retired UPDATE (operator.js:571) matches on "id = $1 AND EXISTS (SELECT 1 FROM minted)" and asks nothing else, so the second statements EPQ recheck after the first commits STILL matches and the second mint lands too. Same target building would abort on zones_one_live_name_idx; two DIFFERENT buildings is the hole.

*** THE OBVIOUS FIX IS WORSE THAN THE DEFECT - READ THIS BEFORE TOUCHING IT. *** Adding "AND active AND location_id IS NOT NULL" to the retired UPDATEs WHERE makes the second statements retire match 0 rows while its claim and minted have ALREADY committed - the final SELECT then returns no row, the handler falls through to the re-read and answers 404 unknown_zone, and a zone was minted on a claimed card anyway. That IS the partial application decision-55 section 3 forbids. Do not do it.

THE FIX: make the old CTE take the row lock - SELECT id, name, note FROM zones WHERE id = $1 AND active AND location_id IS NOT NULL FOR UPDATE. The second statement then blocks in old, re-reads after the lock releases, sees active = false, produces no row, and the whole chain collapses to a clean 404 unknown_zone with nothing written. One clause.

Severity is low: it needs two operators reassigning the SAME door inside the same statement window, into DIFFERENT buildings. Filed because the cost of the wrong fix is high, not because the race is likely.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 the CTE takes a row lock on the old zone (FOR UPDATE in the old CTE), not a re-predicate on the retired UPDATE
- [x] #2 server/check-api.js gains a REAL two-connection race case: two overlapping reassigns of one zone into two different buildings end with exactly ONE live replacement zone and one clean 404/409 for the loser
- [x] #3 the RED case is documented in the test: reverting to the plain SELECT reproduces two live zones
- [x] #4 no refusal path can leave a claimed reported_tag or a minted zone behind - re-assert the existing no-partial-application cases still pass
- [x] #5 full server/check-api.js has no new failures beyond the pre-existing check-telemetry-wire one (TASK-280)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in b7d4759 (server/routes/operator.js, server/check-api.js).

AC#1: the old CTE now reads
  SELECT id, name, note FROM zones WHERE id = $1 AND active AND location_id IS NOT NULL
  FOR UPDATE
The retired UPDATE's WHERE is UNCHANGED (id = $1 AND EXISTS (SELECT 1 FROM minted)) and a
regex assertion in the test pins it that way, so the forbidden re-predicate fix cannot creep
in later. The statement text moved to an exported const REASSIGN_ZONE_SQL so the race test
runs the REAL text, not a copy that can drift.

AC#2: new check-api.js test 'reassign-building: two overlapping reassigns of one zone cannot
both mint (TASK-285)'. Two separate pg.Client connections, both in open transactions: A runs
the statement and HOLDS it uncommitted, B starts the same statement against the SAME zone into
a DIFFERENT building and is proven still pending after 300ms, then A commits. Deterministic
overlap, not two sequential awaits on one connection. GREEN output:
  [TASK-285 GREEN, FOR UPDATE] loser blocked: true, loser rows: 0, live zones: 1, claimed cards: 1
Loser also asserted over HTTP: 404 unknown_zone, its reported_tag still resolved_at NULL, no
zone row minted for it.

AC#3: the RED case RUNS in the same test, against the same statement with FOR UPDATE stripped
into a local string (repo never left broken). Output:
  [TASK-285 RED, plain SELECT] live zones for the door: 2 in buildings d31ef7c6-... | f6e34d6f-...
i.e. exactly the reported defect, reproduced every run.

AC#4: the TASK-281 no-partial-application test 'reassign-building refuses every bad end, and
NEVER applies half of itself' passes unchanged (unknown zone, unbound zone, inactive/unknown
target, never-reported tag, already-resolved tag, duplicate name, malformed bodies, admin
session) - not edited by this commit.

AC#5: full node check-api.js run: 1 FAILED, and it is the pre-existing check-telemetry-wire
one (TASK-280). No new failures.

Not pushed, not deployed. git diff --stat confirms only server/ files staged.
<!-- SECTION:NOTES:END -->
