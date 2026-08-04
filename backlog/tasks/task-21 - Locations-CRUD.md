---
id: TASK-21
title: Locations CRUD
status: Done
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-04 16:49'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-15
  - TASK-2
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
List locations: name, address, tag UID, building owner, contract info. Add/edit/remove. Tag UID typed in. Building owner + contract fields present as Coming in v2 stubs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 List all locations with key info
- [x] #2 Add location with name + tag UID + address + coordinates
- [x] #3 Edit/remove with guard warnings
- [x] #4 Building owner/contract fields visible as stubs
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE.

Live routes (401 unauthenticated, i.e. registered): `POST /admin/locations`,
`DELETE /admin/locations/:id`, `POST /admin/locations/:id/geocode`,
`GET|POST /admin/locations/:id/contracts`.
`curl https://timesheets.exe.xyz/locations/` -> 200. Frame: docs/media/admin-locations.png.
Production `locations` holds the real building: slug `hoiv-arsenalstrasse-11`,
id c3c37d4a-ca0a-42c5-b248-9704b9907ec7.

AC2 deviates and the deviation is the decision: the tag UID is NOT typed in. decision-5 and
decision-21 key a location by its UUID, and the tag carries that UUID. There is no UID column
to fill.

AC4 is exceeded rather than met: building owner and contract are no longer stubs. They are real
tables (`clients`, `contacts`, `location_contracts` from migration 003/005, all applied in
production) with their own screens at /clients/ and /contracts/. See the client/contract task.

Coordinates are captured by the geocode route rather than typed — but that route has no API key
on the server today, so the one production building has lat NULL. Tracked in TASK-16, not here.
<!-- SECTION:NOTES:END -->
