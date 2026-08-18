---
id: TASK-156
title: >-
  Zones: migration 006_zones.sql (zones table + two nullable tap-fact columns on
  shifts)
status: To Do
assignee: []
created_date: '2026-08-18 03:05'
labels:
  - db
  - zones
dependencies: []
documentation:
  - backlog/docs/ZONES-DESIGN.md
priority: high
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The schema cannot express a building with several cleanable areas. Add one child table and two nullable columns; create ZERO rows.

Full SQL is written out in backlog/docs/ZONES-DESIGN.md section 7 and the reasoning is decision-37 (PROPOSED - do not build until the owner accepts it).

Shape, briefly: zones(id UUID PK gen_random_uuid, location_id -> locations, name, note, tag_serial, tag_deployed_at, active, created_at) + UNIQUE(id, location_id) for the composite FK; shifts gains start_zone_id / end_zone_id, both NULLable, both wired with COMPOSITE FKs (zone_id, location_id) -> zones(id, location_id) so a shift can never name another building's zone (MATCH SIMPLE: the check is skipped while the zone column is NULL).

NO tags table: a zone row IS the tag record (decision-5 already made our own tags identity-free). tag_serial is the ADOPTED-hardware exception only, and a serial must never authenticate anything (decision-15).

NO BACKFILL. No default zone per building. Existing shifts keep start_zone_id NULL, which is the honest record of 'a building-level tag was tapped, or this predates zones'. Inventing an 'Eingang' row would put a fabricated measurement into a payroll database - 005 refused the same move for contracts.

House rules: additive only, 001-005 are applied on the live box and not editable, no BEGIN/COMMIT (migrate.js runs each file with psql -1).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 server/db/migrations/006_zones.sql exists and applies cleanly to a scratch database seeded from 001-005
- [ ] #2 Applying it creates zero rows: SELECT count(*) FROM zones = 0, and every existing shift has start_zone_id IS NULL AND end_zone_id IS NULL
- [ ] #3 Composite FK proven: inserting a shift whose start_zone_id belongs to a different location_id is REFUSED by the database (23503), and a shift with start_zone_id NULL is accepted
- [ ] #4 UNIQUE partial indexes proven: two active zones with the same name (any case/whitespace) in one building are refused; the same name is accepted after the first is deactivated; two zones claiming one tag_serial are refused
- [ ] #5 tag_serial CHECK rejects a serial that is not uppercase colon-separated hex
- [ ] #6 The file contains no BEGIN/COMMIT and does not edit 001-005
- [ ] #7 Payroll, P&L, analytics, portal and ops/sql/autoclose.sql produce byte-identical output before and after the migration on the same seeded database
<!-- AC:END -->
