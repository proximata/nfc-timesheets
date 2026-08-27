---
id: TASK-190
title: 'Migration 006: zones, location_revenue, and a worker rate that cannot be zero'
status: Done
assignee: []
created_date: '2026-08-19 13:54'
updated_date: '2026-08-27 07:33'
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
- [x] #1 server/db/migrations/006_zones_revenue_rates.sql exists and matches ZONES-MODEL.md $6
- [x] #2 Applied to a scratch DB via server/db/migrate.js: exits 0, and re-running is a no-op
- [x] #3 RED, seeded: INSERT a worker with hourly_rate_cents = 0 BEFORE the migration, then apply -> the file RAISES, names the count, and the database is unchanged. Set the rate, re-run -> applies
- [x] #4 RED, seeded: after applying, INSERT INTO workers (name) VALUES ('x') raises 23502 and INSERT ... VALUES ('x', 0) raises 23514. Drop the constraint -> both succeed and land a 0
- [x] #5 RED, seeded: INSERT a shift naming a zone of a DIFFERENT building raises 23503
- [x] #6 location_revenue rejects month = '2026-09-15' (23514) and accepts '2026-09-01'
- [x] #7 server/db/check-migrate.js passes; server/db/README.md lists 006
- [x] #8 NOT applied to production in this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, AC-checkbox hygiene only (read-only; no app code touched, no deep re-verification of this task's individual claims).
Headline claims confirmed live on schimmer-glanz.exe.xyz via read-only psql:
 - decision-41: workers.hourly_rate_cents is REQUIRED with NO default. information_schema.columns -> hourly_rate_cents | is_nullable=NO | column_default=(empty). Matches server/db/migrations/006_zones_revenue_rates.sql:64-65 (DROP DEFAULT, then CHECK workers_rate_positive (hourly_rate_cents > 0)).
 - decision-42/28: the revenue fact table exists. to_regclass('location_revenue') -> location_revenue. Defined at 006_zones_revenue_rates.sql:86-108 (month-start CHECK, one-live-row unique index on (location_id, month) WHERE superseded_at IS NULL, append-only).
 - migration 006 is applied on production: schema_migrations lists 001..013 including 006_zones_revenue_rates.sql.
ACs checked as a batch on that basis. Nothing here re-litigates the individual AC wording.
<!-- SECTION:NOTES:END -->
