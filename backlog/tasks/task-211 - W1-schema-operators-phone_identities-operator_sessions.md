---
id: TASK-211
title: 'W1 schema: operators, phone_identities, operator_sessions'
status: To Do
assignee: []
created_date: '2026-08-20 07:27'
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
- [ ] #1 operators, phone_identities and operator_sessions exist; workers and admins are byte-identical to today (schema diff proves it)
- [ ] #2 phone_identities.phone_e164 CHECK enforces E.164 shape; a malformed value is refused at the database, not just the API
- [ ] #3 concurrently inserting the same phone as a worker identity and an operator identity from two connections: exactly one commits, the other raises 23505 — demonstrated, not assumed
- [ ] #4 a phone_identities row with BOTH worker_id and operator_id set is accepted (the owner-cleans-a-building case); a row with neither is refused by the CHECK
- [ ] #5 node server/db/check-migrate.js passes against a fresh database
<!-- AC:END -->
