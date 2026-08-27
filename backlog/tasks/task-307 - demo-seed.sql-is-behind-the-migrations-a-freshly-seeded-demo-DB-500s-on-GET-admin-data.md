---
id: TASK-307
title: >-
  demo/seed.sql is behind the migrations: a freshly seeded demo DB 500s on GET
  /admin/data
status: To Do
assignee: []
created_date: '2026-08-27 16:08'
labels:
  - demo
  - tooling
  - server
dependencies: []
priority: medium
ordinal: 225000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-296 review gate bringing the demo stack up, 2026-08-27.

WHERE. demo/seed.sql, server/db/migrations/014_manual_shift_entry.sql, 015_feature_flags.sql.

MEASURED STATE. After the documented setup (psql -q -d nfc_demo -f demo/seed.sql; node demo/make-admin.mjs; server on 8082), the admin API answers:
    [500] GET /admin/data: column s.manual_start does not exist
    [req] GET /admin/data 500 43ms err=internal_error
because seed.sql predates 014 (manual_start/manual_close, decision-56) and 015 (feature_flags + admins.role, decision-57). Applying the two migration files by hand against nfc_demo fixed it and both applied cleanly - which is itself a useful smoke test of 015: admins.role landed with DEFAULT admin, feature_flags seeded fun_shift_screen=false.

WHAT BREAKS. Every demo recorder and device check that reads /admin/data (record-android.mjs's pre-flight, make-admin flows, anything picking a worker or location) dies on a 500 that names a column, not a setup step. The failure looks like a server bug and is a stale fixture.

FIX. Two options, pick one and say so in DEMO.md:
 (a) seed.sql stops carrying DDL and the documented setup runs the migrations first, then seeds DATA only - the honest shape, since db/migrations is already the source of truth and 001-014 are applied on the live box and uneditable;
 (b) seed.sql keeps its DDL and gains a check that fails loudly when its column set differs from the migrations, so drift is caught at seed time rather than at the first 500.
(a) is preferred: one schema definition, not two that will drift again the next time a decision adds a column.

MUST NOT REGRESS. The seed's invented data stays invented - no real names, rates or addresses ever enter it. Nothing here touches production.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a fresh nfc_demo built from the documented steps answers GET /admin/data 200 with no manual migration
- [ ] #2 DEMO.md section 1 updated to whichever shape is chosen
- [ ] #3 drift cannot recur silently: either one schema source, or a seed-time check that fails on a column-set mismatch
<!-- AC:END -->
