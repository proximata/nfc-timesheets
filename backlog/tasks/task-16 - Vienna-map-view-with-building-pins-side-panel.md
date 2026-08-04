---
id: TASK-16
title: Vienna map view with building pins + side panel
status: In Progress
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-04 16:49'
labels:
  - web
  - ux
milestone: m-3
dependencies:
  - TASK-15
  - TASK-2
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dashboard home = map of Vienna (Leaflet or Mapbox free tier). Buildings as pins with thumbnails. Click pin -> side panel slides in with building summary: name, address, photo, total hours, top 5 metrics. Period selector: this week/month/quarter/year/all (5 views, default this week).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Map renders centered on Vienna
- [ ] #2 Each building appears as pin at coordinates
- [ ] #3 Pin shows thumbnail photo or placeholder
- [x] #4 Side panel slides in with summary on click
- [x] #5 Period selector switches all displayed metrics
- [x] #6 Panel closable, map interactive behind it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — CODE COMPLETE, BUT THE MAP IS BLANK IN PRODUCTION FOR TWO INDEPENDENT REASONS.

MET in code and live: web/app/page.tsx + web/lib/map.ts (Google Maps via a <script> tag and an
eleven-line interface — no npm map package). AC4 side panel, AC5 five-period selector, AC6
closable panel. `curl https://timesheets.exe.xyz/` -> 200. Frame: docs/media/admin-dashboard.png.
The map has six NAMED states and never a blank rectangle: noKey, noPins, loading, ready, blocked
(gm_authFailure), failed (10 s timeout). Buildings that cannot be pinned are listed in a table
with the reason, so nothing is ever invisible.

NOT MET IN PRODUCTION — AC1, AC2, AC3. I checked the live site, not the source:
1. NO KEY IN THE BUNDLE. I downloaded all 13 JS chunks of the live /locations/ page — 744 771
   bytes — and grepped: no `AIza…` anywhere, and the string "no Google Maps key" IS present.
   Cause: ops/deploy.sh:44 passes only `NEXT_PUBLIC_DEFAULT_LOCALE=de` to `pnpm verify`. The key
   is a build-time inline; a build that is not given it ships without it. web/README.md:185
   already documents this. FIX: one line in ops/deploy.sh. LOW effort.
2. NOTHING IS GEOCODED. Production `locations` has one row and its `lat` IS NULL. Cause:
   `GOOGLE_GEOCODING_KEY` is not on the server — /etc/nfc/env contains exactly APP_KEY,
   DATABASE_URL, PORT and nothing else. `POST /admin/locations/:id/geocode` is live but has no
   key to call Google with. FIX: install the key (it already exists in the psst vault) and run
   the geocode route once per building.

So even with the key inlined the map would draw zero pins. BOTH must be done, in that order.
CONSEQUENCE if never done: the dashboard is a table instead of a map. Nothing is lost or
mispaid — this is presentation, not payroll.
<!-- SECTION:NOTES:END -->
