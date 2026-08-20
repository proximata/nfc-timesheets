---
id: TASK-211
title: 'W1 schema: operators, phone_identities, operator_sessions'
status: Done
assignee: []
created_date: '2026-08-20 07:27'
updated_date: '2026-08-20 13:04'
labels:
  - migration
  - server
  - operators
dependencies: []
references:
  - server/db/migrations/004_worker_enrolment_codes.sql
  - server/db/migrations/002_worker_identity.sql
documentation:
  - backlog/docs/OPERATOR-MODEL.md
  - backlog/decisions/decision-45
priority: high
ordinal: 129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE SCHEMA HALF of decision-45. New migration file (007, additive only, no BEGIN/COMMIT — migrate.js wraps it), copied from the annotated sketch in backlog/docs/OPERATOR-MODEL.md §6 — do not re-derive it. workers and admins get ZERO changes: no column, no constraint. CREATE TABLE operators (name, active, created_by, five enrolment_code_* columns copied verbatim from 004). CREATE TABLE phone_identities (phone_e164 PRIMARY KEY CHECK'd as E.164, worker_id UNIQUE NULL, operator_id UNIQUE NULL, CHECK at least one set) — this table, not a UNIQUE column on two tables, is what makes the owner's 'phones must never collide' constraint impossible rather than merely checked. CREATE TABLE operator_sessions, byte-for-byte the shape of worker_sessions (002).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 operators, phone_identities and operator_sessions exist; workers and admins are byte-identical to today (schema diff proves it)
- [x] #2 phone_identities.phone_e164 CHECK enforces E.164 shape; a malformed value is refused at the database, not just the API
- [x] #3 concurrently inserting the same phone as a worker identity and an operator identity from two connections: exactly one commits, the other raises 23505 — demonstrated, not assumed
- [x] #4 a phone_identities row with BOTH worker_id and operator_id set is accepted (the owner-cleans-a-building case); a row with neither is refused by the CHECK
- [x] #5 node server/db/check-migrate.js passes against a fresh database
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED INDEPENDENTLY, 2026-08-20, against a database restored from the production backup nfc-20260820T000158Z (backlog/docs/VERDICT-W1-DB.md section 2.2). 007 applies after 006, applied_at(006) < applied_at(007) asserted rather than assumed, re-run is 'up to date', and 006+007 together invent ZERO rows (zones 0, location_revenue 0, operators 0, phone_identities 0, operator_sessions 0). HOIV survives at 48.1761151/16.3953038, active. 007 also applies ALONE on a 005 schema - it has no functional dependency on 006, which is decision-45 section 2.1's table boundary working as drawn. Mutation: sh server/check-phone-namespace-mutants.sh <dump> -> 6 red, 0 alive, incl. losing the PK, losing operator_id UNIQUE, and removing phone_identities_claims. That last one was ALIVE on the first run and the missing assertion has been added (ceb6f2b).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
007_operator_identity.sql ships operators/phone_identities/operator_sessions with zero changes to workers/admins and zero rows created. All 5 ACs verified against a live Postgres instance, not merely written — node server/db/check-migrate.js: OK.
<!-- SECTION:FINAL_SUMMARY:END -->
