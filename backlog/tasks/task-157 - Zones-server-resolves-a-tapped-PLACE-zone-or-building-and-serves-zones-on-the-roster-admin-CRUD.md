---
id: TASK-157
title: >-
  Zones: server resolves a tapped PLACE (zone or building) and serves zones on
  the roster + admin CRUD
status: To Do
assignee: []
created_date: '2026-08-18 03:06'
labels:
  - server
  - api
  - zones
dependencies:
  - TASK-156
documentation:
  - backlog/docs/ZONES-DESIGN.md
priority: high
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make a zone UUID tappable without breaking the one tag on a wall or the one APK in the field. Design + rejected alternatives: backlog/docs/ZONES-DESIGN.md sections 2, 3 and 8. Reasoning: decision-37 (PROPOSED).

THE TAG URI DOES NOT CHANGE. It stays https://<host>/t?l=<uuid>. The parameter 'l' stops meaning 'location id' and means 'the id of the place that was tapped'. New tags carry a ZONE uuid; a LOCATION uuid must keep resolving FOR EVER, because the deployed HOIV tag is a foreign serial-adopted tag whose synthesised URI carries a location UUID, and because a wall is a site visit.

lib/validate.js activeLocation() becomes activePlace(): ONE query (zone-of-an-active-building UNION ALL active-building-with-zone-NULL) that returns exactly one row or refuses. 0 rows -> 422 unknown_location, the SAME error code as today: the shipped Android build renders any new code as 'unknown status from a newer server'. More than 1 row (only reachable by a UUID collision across the two tables) -> refuse, never pick one.

A SHIFT STILL ATTACHES TO THE BUILDING. shifts.location_id stays NOT NULL and stays what payroll reads. start_zone_id / end_zone_id are tap facts and never a cost split - the same standing as material_requests.location_id under decision-6.

Wire compatibility with the build already on the workers' phones is the constraint that shapes this task: POST /shifts/open keeps the field NAME location_uuid while its value may now be a zone id (ponytail: the name is now a lie; ceiling and upgrade path are in the design doc), and roster gains a FLAT zones array beside locations because Api.kt reads getJSONArray("locations") and ignores everything else.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 activePlace() resolves a zone UUID to {location_id, zone_id} and a location UUID to {location_id, zone_id: null}; an inactive zone, a zone of an inactive building, an unknown UUID and a non-UUID all give 422 unknown_location
- [ ] #2 POST /shifts/open accepts a zone UUID in location_uuid and stores location_id + start_zone_id; it accepts a location UUID and stores location_id with start_zone_id NULL
- [ ] #3 POST /shifts/close accepts an OPTIONAL location_uuid, stores end_zone_id, and answers 422 wrong_building when the tapped place resolves to a different building than the open shift; a close with the field absent behaves exactly as today
- [ ] #4 GET /roster returns a flat zones array [{id, location_id, name, tag_serial}] alongside the unchanged locations array
- [ ] #5 GET /shifts/open, /shifts/recent and /shifts/unresolved carry a nullable zone_name beside the existing location_name
- [ ] #6 POST /admin/zones upserts a zone (409 on a duplicate live name in the building, 409 on a tag_serial already claimed); DELETE /admin/zones/:id SOFT-deactivates and never deletes
- [ ] #7 PATCH /admin/shifts/:id CLEARS start_zone_id and end_zone_id in the same statement when location_id changes, so the composite FK cannot raise 23503
- [ ] #8 DELETE /admin/locations/:id also deactivates that building's zones (an active zone under an inactive building is unresolvable and reads as a dead tag)
- [ ] #9 A check PINS that the client portal payload is still exactly {date, first name, minutes}: no zone id, no zone name, on any route under /reinigung
- [ ] #10 Regression: payroll, /admin/data, the P&L, the analytics trend and ops/sql/autoclose.sql are unchanged and produce identical numbers on the seeded database
- [ ] #11 Server dependencies are still exactly pg + @sentry/node (decision-23)
<!-- AC:END -->
