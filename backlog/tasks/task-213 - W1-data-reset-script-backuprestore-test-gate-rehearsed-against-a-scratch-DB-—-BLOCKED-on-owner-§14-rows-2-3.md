---
id: TASK-213
title: >-
  W1 data reset: script, backup+restore-test gate, rehearsed against a scratch
  DB — BLOCKED on owner §14 rows 2/3
status: Done
assignee: []
created_date: '2026-08-20 07:28'
updated_date: '2026-08-20 08:12'
labels:
  - ops
  - operators
  - data-safety
dependencies: []
references:
  - ops/backup/pg-backup.sh
  - ops/backup/restore-test.sh
  - server/db/check-prod-restore.mjs
documentation:
  - backlog/docs/OPERATOR-MODEL.md
  - backlog/decisions/decision-46
priority: high
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implements decision-46. ops/reset-w1.sql from the sketch in OPERATOR-MODEL.md §10: pre-flight guards (admins non-empty NOW, no live enrolment code without ALLOW_LIVE_CODE_LOSS=1), row counts before/after, explicit ordered DELETE (worker_sessions, material_requests, shifts, portal_grants, location_revenue if present, zones if present, location_contracts, workers, locations), a final admins-non-empty assertion inside the SAME transaction that aborts on failure.\n\nBLOCKED on two owner decisions named in OPERATOR-MODEL.md §14: (2) does this run before or after decisions 41-44/migration 006 — recommended before, per decision-46 §2, but not this task's to assume acted upon; (3) wait for the 2026-08-22 enrolment code or wipe now with ALLOW_LIVE_CODE_LOSS=1. Do not run against production. Production is read-only for every agent on this workflow.\n\nMUST be rehearsed against a RESTORED DUMP in a scratch database before it is trusted, per this project's standing rule that every destructive script is exercised against a restore, never against production directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 cross-check query (pg_constraint where confrelid is workers or locations) confirms the script's table list is complete against the CURRENT schema
- [x] #2 run against a scratch DB seeded with a live (unexpired) enrolment code: the script REFUSES and rolls back nothing is deleted — shown RED first with the guard commented out, then GREEN with it restored
- [x] #3 run against a scratch DB with a hand-edited copy that also DELETEs admins: the script's final assertion fires and the transaction rolls back — admins count is unchanged after — shown RED first (assertion removed, admins actually empty) to prove the assertion is load-bearing
- [x] #4 run against a scratch DB pre-006 (no zones/location_revenue tables): completes without error
- [x] #5 run against a scratch DB post-006 (zones/location_revenue present, seeded with rows): both are cleared, no FK violation
- [x] #6 after a clean run: workers, locations, shifts, zones (if present), location_revenue (if present), location_contracts, material_requests, portal_grants, worker_sessions all read 0; admins, sessions, clients, contacts, inventory_items, app_settings are UNCHANGED in row count
- [x] #7 ops/backup/pg-backup.sh followed by ops/backup/restore-test.sh's verification pattern is documented as the mandatory step immediately before this script ever runs against a real database
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built at ops/reset-w1.sql + ops/check-reset-w1.mjs (commit ee196e9). One divergence from the inherited OPERATOR-MODEL.md §10 sketch, found walking the FK graph 007 introduces and verified live before fixing: phone_identities.worker_id ON DELETE SET NULL drives a worker-only row to (NULL,NULL) mid-DELETE-FROM-workers, violating phone_identities_claims — fixed by detaching (DELETE, never an UPDATE...SET NULL first, which hits the identical CHECK one statement earlier — also caught live before landing the final order). Added beyond the inherited design per this task's own brief: a hard refusal to run against any database not named via -v confirm_database=<name>, checked server-side against current_database() (this psql build's \quit has no exit-code argument, checked, so refusals are real RAISE EXCEPTIONs). All 7 ACs rehearsed against seeded scratch databases, RED-then-GREEN on both guards (live-code guard neutralised to IF false; admins-assertion block deleted outright + a mistake elsewhere), never against production. node ops/check-reset-w1.mjs: OK, 8/8. Flagged, not guessed: the brief's phrase "recreates the operator" is read as keeping the one admins row intact, not as inserting a fresh operators row (decision-46 keeps operators out of this reset's scope; fabricating one would need a name/phone nobody supplied) — recorded in the script's own comment for the owner to correct if that reading is wrong.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
ops/reset-w1.sql: pre-flight guards (admin count, live-code, and a new explicit-database-confirmation refusal), ordered DELETE with the 007 fix inserted before DELETE FROM workers, a same-transaction admins-survives assertion, safe to run twice. ops/check-reset-w1.mjs rehearses every AC against scratch Postgres databases this laptop can build; the actual pg_dump-then-restore step stays a documented, unexercised prerequisite (no production dump on this laptop, by design).
<!-- SECTION:FINAL_SUMMARY:END -->
