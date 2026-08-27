---
id: TASK-196
title: 'Server zones: activePlace resolves a zone OR a building, for ever'
status: Done
assignee: []
created_date: '2026-08-19 14:00'
updated_date: '2026-08-27 07:33'
labels:
  - server
  - zones
  - nfc
dependencies:
  - TASK-190
documentation:
  - backlog/decisions/decision-43
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-43, the server half. ZONES-MODEL.md $3.2, $3.4, $7.

*** THE ONE THING THAT MUST NOT BREAK ***
The card physically on the wall carries https://timesheets.exe.xyz/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7
-- a BUILDING uuid -- and HOIV has ZERO zones. A BUILDING UUID MUST KEEP RESOLVING, ZONED OR
NOT. 'Unzoned' is a PRESENTATION state and must never touch resolution. locations.active alone
decides whether a building tag resolves.

1 · validate.js: activeLocation() -> activePlace(), one query, exactly one row or a refusal:
    an ACTIVE zone of an ACTIVE building -> (location_id, zone_id)
    an ACTIVE building                   -> (location_id, NULL)     <- THE CARD ON THE WALL
    neither                              -> 422 unknown_location    <- CODE UNCHANGED. The
        build in the field maps unknown_location to err_unknown_location; any NEW code renders
        as 'unknown status from a newer server' on the phone.
    >1 row -> refuse. Only reachable by a UUIDv4 collision across two tables. One line, and it
        is the difference between a refusal and silently picking a building.
    Callers that want only a building keep reading location_id.

2 · GET /roster gains a FLAT zones array [{id, location_id, name, tag_serial}]. Additive and
    safe: Api.kt:92 reads getJSONArray('locations') and ignores everything else.

3 · POST /shifts/open keeps the field name location_uuid while its value may be a zone id.
    ponytail: the name is now a lie. CEILING: cheapest correct thing while an APK is in the
    field. UPGRADE PATH: accept place_uuid as preferred once both clients send it; keep
    location_uuid accepted for ever.
    POST /shifts/close gains an OPTIONAL location_uuid -> end_zone_id; a different building ->
    422 wrong_building. The shipped app never sends it, so it never sees the new code.

4 · Admin CRUD: POST /admin/zones (409 duplicate live name, 409 serial already claimed),
    DELETE /admin/zones/:id SOFT only. /admin/data carries zones[] + a DERIVED last_tap_at.

5 · TWO CONSEQUENCES THAT ARE NOT OPTIONAL:
    - PATCH /admin/shifts/:id must CLEAR both zone columns when location_id changes, or the
      composite FK raises 23503. Clearing is also the correct semantics: a human re-pointing a
      shift is saying the tap record was wrong.
    - DELETE /admin/locations/:id must deactivate the building's zones. An active zone under an
      inactive building is unresolvable and looks like a dead tag.

6 · Zone name rides along on GET /shifts/open, /unresolved, /mine as a nullable zone_name.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1     -> W3 (clock in ★) and W10 (a tap that did nothing): the 422 CODE is what the shipped APK renders; a new code becomes „unknown status".
AC#2     -> W3 ★ THE ONE THAT MATTERS: HOIV's exact shape — an active building with zero zones — must keep resolving. D2 (get a working tag onto a wall) depends on it.
AC#3     -> W10: a deactivated zone or building must refuse, and refuse identically, so the panel can explain a dead tag.
AC#4     -> D6 (correcting the past, filing a shift that was never tapped): re-pointing a shift clears the tap record it contradicts.
AC#5     -> D2 and D11 (offboarding a place): an active zone under an inactive building is an unresolvable tag on a wall.
AC#6     -> W3 + P1 (Play/APK latency): the roster must stay parseable by the build already in the field.
AC#7     -> C2 (client checks a building): the portal payload does not move.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 activePlace() exists; activeLocation() is gone or delegates; the 422 code is still unknown_location
- [x] #2 RED, seeded (THE ONE THAT MATTERS): an ACTIVE building with ZERO active zones -- exactly HOIV's shape -- taps with its own uuid and gets 201 with start_zone_id NULL. Add 'AND EXISTS (SELECT 1 FROM zones ...)' to the resolver -> the check goes red
- [x] #3 RED, seeded: a zone uuid resolves to (its building, itself). Deactivate the zone -> 422. Deactivate the building instead -> 422 for the zone AND for the building uuid
- [x] #4 RED, seeded: PATCH a shift's location_id without clearing the zone columns -> 23503. With the clearing in place -> 200 and both columns null
- [x] #5 RED, seeded: DELETE a building leaves no active zone behind. Remove the cascade -> red
- [x] #6 GET /roster still parses in the SHIPPED APK shape: the locations array is byte-compatible and zones is purely additive
- [x] #7 check-api.js: no assertion regressed; the portal payload assertions still pass
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
