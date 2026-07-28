---
id: TASK-2
title: Database schema (Postgres)
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
labels:
  - server
  - db
milestone: m-0
dependencies:
  - TASK-1
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design and apply Postgres schema. Tables: workers, locations, shifts, buildings (owner info, contract annual amount, address, coordinates, photo URL), hourly_rates (worker_id, rate, effective_from). FKs, indexes on shifts(worker_id,start) and shifts(location_id,start). Seed script for dev data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Schema applied via migration SQL file in repo
- [ ] #2 FK constraints enforce referential integrity
- [ ] #3 psql \dt shows all expected tables
- [ ] #4 Seed script exists for dev data
<!-- AC:END -->
