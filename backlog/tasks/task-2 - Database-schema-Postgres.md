---
id: TASK-2
title: Database schema (Postgres)
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:46'
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
- [x] #1 Schema applied via migration SQL file in repo
- [x] #2 FK constraints enforce referential integrity
- [x] #3 psql \dt shows all expected tables
- [x] #4 Seed script exists for dev data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE against the PRODUCTION database (read-only).

- `\dt` on `nfc` returns 14 tables: admins, app_settings, clients, contacts, inventory_items,
  location_contracts, locations, material_requests, portal_grants, schema_migrations, sessions,
  shifts, worker_sessions, workers. AC3 met.
- AC1: `SELECT * FROM schema_migrations` shows five files applied in production —
  001_init.sql (2026-07-28), 002_worker_identity.sql, 003_clients_contracts_inventory.sql,
  004_worker_enrolment_codes.sql, 005_v2_features.sql (2026-08-03 20:25). Source of each is in
  server/db/migrations/.
- AC2: `\d shifts` shows FKs shifts_worker_id_fkey -> workers(id) and
  shifts_location_id_fkey -> locations(id).
- AC4: server/db/seed.sql.

Shape differs from the original description and that is correct: `buildings` became `locations`
+ `clients` + `location_contracts` (decision-28), and `hourly_rates` was never created — the rate
is a single `workers.hourly_rate_cents` column. Rate history is filed as its own task.
Indexes present beyond the two asked for, incl. shifts_one_open_per_worker_idx UNIQUE WHERE
end_time IS NULL, which is what enforces decision-19 server-side.
<!-- SECTION:NOTES:END -->
