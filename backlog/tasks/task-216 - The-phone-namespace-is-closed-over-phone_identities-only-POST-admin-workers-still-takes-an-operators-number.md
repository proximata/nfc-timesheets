---
id: TASK-216
title: >-
  The phone namespace is closed over phone_identities only: POST /admin/workers
  still takes an operator's number
status: To Do
assignee: []
created_date: '2026-08-20 13:02'
labels:
  - operators
  - security
  - blocked
dependencies: []
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED this session on a database restored from the production dump nfc-20260820T000158Z and migrated to 007 (backlog/docs/VERDICT-W1-DB.md D1; server/check-phone-namespace.mjs section 3, which measures it rather than asserting it away).

THE OWNER, VERBATIM: 'Operator phones and worker phones live in ONE namespace and may never collide, so the uniqueness has to be enforced by the database, not by a screen.'

THE THREE DOORS, MEASURED. operator takes a worker's number -> 409 phone_claimed. direct SQL, either direction -> 23505 on phone_identities_pkey, including a concurrent race where the loser blocks on the winner's uncommitted row for >250ms first. WORKER TAKES AN OPERATOR'S NUMBER THROUGH THE PANEL -> 201 CREATED, stored verbatim as free text.

WHY. server/routes/admin.js has exactly ONE write into phone_identities (line 629, createOperator) and ZERO for workers. POST /admin/workers (line 468) runs v.optionalPhone, which is documented free contact text and deliberately never normalised. So the registry today holds ONLY operator claims; the cross-kind refusal is real in the DDL and unreachable through any route, because no worker row is ever an identity. check-phone-namespace.mjs has to seed the worker side with a raw INSERT to test that direction at all.

This is decision-45 section 2.3 as designed. It is filed because the owner's sentence is not yet true of the deployed system and nothing in the tree will notice: every worker created through the panel before this closes holds an unclaimed phone string that a W5 SMS login could resolve to two person-rows.

BLOCKED, AND DO NOT DECIDE IT HERE. Closing this means POST /operator/workers, which is absent (404) and blocked on OPERATOR-MODEL.md section 8 / decision-41 (PROPOSED): 'name + phone' supplies no rate, and 41 as worded makes that a 23502 on every call. The owner must rule first. Distinct from TASK-215, which is the copy on /operators/ and assumes a refusal that production cannot currently produce.

ACCEPTANCE, when unblocked: node server/check-phone-namespace.mjs <dump> must have its section 3 rewritten from a measured hole into a refusal, and sh server/check-phone-namespace-mutants.sh <dump> must stay 6 red 0 alive. Its 'POST /operator/workers is absent (404)' assertion fails the day the route lands, on purpose.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /admin/workers refuses a phone already claimed in phone_identities, in BOTH spellings, with a body that names nobody
- [ ] #2 a worker created through a validated path takes a phone_identities row, proven on a restored production dump
- [ ] #3 check-phone-namespace section 3 no longer reports a hole, and the mutant suite stays 6 red 0 alive
<!-- AC:END -->
