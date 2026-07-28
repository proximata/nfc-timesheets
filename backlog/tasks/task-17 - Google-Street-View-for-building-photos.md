---
id: TASK-17
title: Google Street View for building photos
status: To Do
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-07-28 14:25'
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
- [ ] #2 Buildings without coverage show styled placeholder
- [ ] #3 Admin can override with uploaded photo
- [ ] #4 Photos cached, not refetched per page load
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RESOLVED: Street View coverage in Vienna verified good. Metadata API tested on 5 addresses across districts 1010/1060/1020/1100/1220 - all status OK, imagery dates 2022-04 to 2026-04 (most 2024+). Street View is viable as the PRIMARY photo source; admin upload becomes a rare fallback, not a required path.

KEYS PROVISIONED (GCP project nfc-timesheets, billing linked):
- NEXT_PUBLIC_GOOGLE_MAPS_KEY - browser key, referrer-restricted to localhost:3000 + *.vercel.app, scoped to Maps JS + Street View Static + Maps Static
- GOOGLE_GEOCODING_KEY - server key, no referrer restriction, scoped to Geocoding API only
Both stored in psst vault (.psst/envs/ is gitignored). Retrieve with: psst get <NAME>

IMPLEMENTATION NOTE: geocode building address ONCE at creation time server-side (GOOGLE_GEOCODING_KEY), store lat/lng on the location row. Do not geocode on every page render. Street View images embed client-side via <img src> using the browser key.

TODO before production: tighten allowed-referrers from *.vercel.app to the real production domain.
<!-- SECTION:NOTES:END -->
