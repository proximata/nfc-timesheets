---
id: TASK-213
title: >-
  W1 data reset: script, backup+restore-test gate, rehearsed against a scratch
  DB — BLOCKED on owner §14 rows 2/3
status: To Do
assignee: []
created_date: '2026-08-20 07:28'
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
- [ ] #1 cross-check query (pg_constraint where confrelid is workers or locations) confirms the script's table list is complete against the CURRENT schema
- [ ] #2 run against a scratch DB seeded with a live (unexpired) enrolment code: the script REFUSES and rolls back nothing is deleted — shown RED first with the guard commented out, then GREEN with it restored
- [ ] #3 run against a scratch DB with a hand-edited copy that also DELETEs admins: the script's final assertion fires and the transaction rolls back — admins count is unchanged after — shown RED first (assertion removed, admins actually empty) to prove the assertion is load-bearing
- [ ] #4 run against a scratch DB pre-006 (no zones/location_revenue tables): completes without error
- [ ] #5 run against a scratch DB post-006 (zones/location_revenue present, seeded with rows): both are cleared, no FK violation
- [ ] #6 after a clean run: workers, locations, shifts, zones (if present), location_revenue (if present), location_contracts, material_requests, portal_grants, worker_sessions all read 0; admins, sessions, clients, contacts, inventory_items, app_settings are UNCHANGED in row count
- [ ] #7 ops/backup/pg-backup.sh followed by ops/backup/restore-test.sh's verification pattern is documented as the mandatory step immediately before this script ever runs against a real database
<!-- AC:END -->
