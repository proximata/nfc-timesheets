---
id: TASK-196
title: 'Server zones: activePlace resolves a zone OR a building, for ever'
status: To Do
assignee: []
created_date: '2026-08-19 14:00'
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 activePlace() exists; activeLocation() is gone or delegates; the 422 code is still unknown_location
- [ ] #2 RED, seeded (THE ONE THAT MATTERS): an ACTIVE building with ZERO active zones -- exactly HOIV's shape -- taps with its own uuid and gets 201 with start_zone_id NULL. Add 'AND EXISTS (SELECT 1 FROM zones ...)' to the resolver -> the check goes red
- [ ] #3 RED, seeded: a zone uuid resolves to (its building, itself). Deactivate the zone -> 422. Deactivate the building instead -> 422 for the zone AND for the building uuid
- [ ] #4 RED, seeded: PATCH a shift's location_id without clearing the zone columns -> 23503. With the clearing in place -> 200 and both columns null
- [ ] #5 RED, seeded: DELETE a building leaves no active zone behind. Remove the cascade -> red
- [ ] #6 GET /roster still parses in the SHIPPED APK shape: the locations array is byte-compatible and zones is purely additive
- [ ] #7 check-api.js: no assertion regressed; the portal payload assertions still pass
<!-- AC:END -->
