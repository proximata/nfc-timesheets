---
id: TASK-17
title: Google Street View for building photos
status: In Progress
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-25 15:41'
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
TRIAGE 2026-08-25 — THE CONSOLE BLOCKER IS GONE. A DIFFERENT ONE IS LEFT, SHARED WITH TASK-16.

The 2026-08-04 note's own diagnosis (Street View Static API not enabled on the project) was
already stale — both Geocoding API and Street View Static API were project-enabled. Real cause:
server/lib/geocode.js calls Street View using the SERVER key (GOOGLE_GEOCODING_KEY), and that
key's own API-restriction list only allowed geocoding-backend.googleapis.com. Fixed via gcloud
(added street-view-image-backend.googleapis.com to that key's allowed targets — project
nfc-timesheets, key uid bdedb0a4-...). Live-probed with the real key immediately after:
GET streetview/metadata?location=48.2082,16.3738 -> status: OK, real pano_id returned.
Confirmed visually in Cloud Console (Credentials > that key > Selected APIs: Geocoding API,
Street View Static API).

STILL NOT MET — AC1, AC3. Not because of the key anymore: the one production building has no
coordinates yet (address column empty — see TASK-16's note, same root cause, same fix). Street
View needs lat/lng to ask about. The day TASK-16's address gap closes and geocode-backfill runs,
AC1 closes for free — same event, no separate action needed here.

AC3 (admin upload override) status unchanged from 2026-08-04: not built, rare-fallback,
deprioritized.
<!-- SECTION:NOTES:END -->
