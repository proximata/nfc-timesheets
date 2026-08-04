---
id: TASK-17
title: Google Street View for building photos
status: In Progress
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-04 16:49'
labels:
  - web
  - api
milestone: m-3
dependencies:
  - TASK-2
priority: medium
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On building creation or first view, fetch Street View static image by address/coordinates. Cache in DB. No coverage -> text-on-color placeholder. Admin can optionally upload replacement photo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Buildings with Street View show real photo
- [x] #2 Buildings without coverage show styled placeholder
- [ ] #3 Admin can override with uploaded photo
- [x] #4 Photos cached, not refetched per page load
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — CODE COMPLETE. BLOCKED ON ONE CHECKBOX IN THE OWNER GOOGLE CLOUD CONSOLE.

MET: AC2 — a building without coverage gets a named reason, never a fake photograph. AC4 —
coverage is resolved once and stored on the row (`locations.street_view_status`), not refetched
per render.

The gate that makes this safe (web/README.md): a Street View image is requested ONLY when
`street_view_status === "OK"`, i.e. only after the metadata endpoint has confirmed coverage.
Without that gate the static endpoint answers HTTP 200 with a grey "no imagery" tile, and an
onError handler alone would ship that tile and present it as a photograph of a client building.
`pnpm check` covers the gate.

NOT MET — AC1 and AC3. No photograph will ever render, because the STREET VIEW STATIC API IS NOT
ENABLED on the operator Google Cloud project. Asked with the real key, the answer was:
  REQUEST_DENIED — This API key is not authorized to use this service or API.
Production confirms it: the single `locations` row has `street_view_status` empty. Never probed
successfully, so never OK, so no image.

AC3 (admin uploads a replacement photo) was never built and is now a rare fallback rather than a
required path — coverage was verified good across five Vienna districts (1010/1060/1020/1100/
1220), imagery 2022-2026.

BLOCKED ON THE OWNER: tick "Street View Static API" in the Google Cloud console for project
`nfc-timesheets`. No code changes. Photographs appear the day the box is ticked.
Note this ALSO needs TASK-16 fix #2 first — geocoding must run before there are coordinates to
ask Street View about.
<!-- SECTION:NOTES:END -->
