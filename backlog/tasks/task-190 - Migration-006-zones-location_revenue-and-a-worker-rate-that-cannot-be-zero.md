---
id: TASK-190
title: 'Migration 006: zones, location_revenue, and a worker rate that cannot be zero'
status: Done
assignee: []
created_date: '2026-08-19 13:54'
updated_date: '2026-08-20 04:01'
labels:
  - migration
  - server
  - zones
  - revenue
  - payroll
dependencies: []
documentation:
  - backlog/docs/ZONES-MODEL.md
  - backlog/decisions/decision-41
  - backlog/decisions/decision-42
  - backlog/decisions/decision-43
priority: high
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE SCHEMA HALF of decisions 41, 42 and 43. Nothing else in this batch can start without it.

ONE file, `server/db/migrations/006_zones_revenue_rates.sql`, because all three land before the
client onboards, migrate.js applies files one at a time with `psql -1`, and three files would
create three half-migrated states to reason about. Full annotated sketch:
backlog/docs/ZONES-MODEL.md $6 -- copy it, do not re-derive it.

HOUSE RULES: additive only; NO BEGIN/COMMIT; 001-005 are untouched; no down-migration.

1 · decision-41
   DO $$ guard that RAISES with a COUNT if any worker has hourly_rate_cents <= 0. It refuses;
   it never invents a wage and never deactivates anybody. psql -1 aborts the file cleanly and
   migrate.js records nothing, so it is re-runnable after the rates are set.
   ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;   <- LOAD-BEARING
   ALTER TABLE workers ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);
   DROP DEFAULT is the half that is easy to forget: NOT NULL with DEFAULT 0 still lands a zero
   on any INSERT that omits the column.

2 · decision-42
   CREATE TABLE location_revenue (append-only; superseded_at NULL = the figure in force).
   amount_cents NOT NULL CHECK (>= 0): 0 means 'they paid nothing', row-absence means unknown.
   month DATE, always the 1st, CHECK (EXTRACT(DAY FROM month) = 1).
   Partial unique (location_id, month) WHERE superseded_at IS NULL -- same idiom as
   location_contracts_one_current_idx.
   NO BACKFILL from location_contracts. Copying an agreed rate in would assert a payment.

3 · decision-43
   CREATE TABLE zones (area_sqm NUMERIC(8,2) NULLable, tag_serial, tag_deployed_at, note,
   active), three indexes, UNIQUE (id, location_id).
   ALTER TABLE shifts ADD start_zone_id, end_zone_id + two COMPOSITE FKs against
   (id, location_id) so a shift can never name another building's zone.
   ZERO ROWS CREATED. No default zone, no backfill: nobody knows which door the HOIV card is
   on, and a row saying 'Eingang' would be a fabricated measurement in a payroll database.

Production is 1 building, 0 workers, 0 shifts, 5 migrations -- the cheapest moment there will
ever be. Applying this is two ADD COLUMN with no default, two ADD CONSTRAINT validating against
zero rows, one DROP DEFAULT, one CHECK over an empty table, two CREATE TABLE. Brief locks.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#2 -> §7 "Represent a building with several cleanable areas: **impossible** — no zone table". This migration is the row that deletes.
AC#3,#4 -> D3 (hire a worker and issue a code) and D7 (month-end payroll ★): a wage that cannot be 0 is the input D7 multiplies.
AC#5    -> W3/W6 (clock in; two buildings, one shift): the composite FK is what makes "a shift naming another building's zone" unrepresentable rather than merely unlikely.
AC#6    -> D8 (is this building worth the contract?): a month is a Vienna month or it is not a fact.
AC#7,#8 -> S3 (nightly backup / restore): a migration that cannot be re-run against a restored client dump is a migration that cannot be recovered onto.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 server/db/migrations/006_zones_revenue_rates.sql exists and matches ZONES-MODEL.md $6
- [ ] #2 Applied to a scratch DB via server/db/migrate.js: exits 0, and re-running is a no-op
- [ ] #3 RED, seeded: INSERT a worker with hourly_rate_cents = 0 BEFORE the migration, then apply -> the file RAISES, names the count, and the database is unchanged. Set the rate, re-run -> applies
- [ ] #4 RED, seeded: after applying, INSERT INTO workers (name) VALUES ('x') raises 23502 and INSERT ... VALUES ('x', 0) raises 23514. Drop the constraint -> both succeed and land a 0
- [ ] #5 RED, seeded: INSERT a shift naming a zone of a DIFFERENT building raises 23503
- [ ] #6 location_revenue rejects month = '2026-09-15' (23514) and accepts '2026-09-01'
- [ ] #7 server/db/check-migrate.js passes; server/db/README.md lists 006
- [ ] #8 NOT applied to production in this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 by the verdict probe (backlog/docs/VERIFY-FINAL.md). Production NOT touched, 006 NOT applied there.
node server/db/check-migrate.js -> OK, and its line names 006 explicitly: "006 refuses a rate-less worker before applying cleanly over live rows".
node server/db/check-prod-restore.mjs -> OK against the real 2026-08-20 dump (PROBE-DATA §2): REFUSES on TTL Test, applies after the ops step, re-applies as a no-op, invents 0 rows, HOIV's pin 48.1761151/16.3953038 byte-identical after.
AC#8 satisfied by construction: production is still on schema_migrations = 5.
<!-- SECTION:NOTES:END -->
