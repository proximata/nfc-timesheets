---
id: TASK-16
title: Vienna map view with building pins + side panel
status: In Progress
assignee: []
created_date: '2026-07-28 13:49'
updated_date: '2026-08-25 15:40'
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
TRIAGE 2026-08-25 — BOTH 2026-08-04 SUB-FIXES WERE ALREADY STALE. RE-VERIFIED LIVE.

Fix #1 (deploy.sh missing NEXT_PUBLIC_GOOGLE_MAPS_KEY at build) was already fixed in ops/deploy.sh
before today (line 134 wires it, sourced from psst). It just hadn't been DEPLOYED — the live
bundle still shipped keyless. Ran ./ops/deploy.sh (migrations confirmed up to date first, clean
code-refresh, no schema change). Verified: 'AIza' now present in the live root-page bundle
(chunk 8f296802e3e55289.js at schimmer-glanz.exe.xyz/), dashboard now shows the honest
'1 building has no coordinates, nothing to draw' state instead of the old noKey placeholder.

Fix #2 (GOOGLE_GEOCODING_KEY not on the VM) was ALSO already done before today — /etc/nfc/env
already carries it (39-char value, matches vault). Ran server/bin/geocode-backfill.js on the box:
'0 building(s) to look up' — not a key failure, the WHERE clause requires a non-empty address
and the one production location ('test', id 5c96bb23-9d65-45f0-9eea-b18c70f4b867) has
address = NULL. Confirmed via direct psql query.

REMAINING BLOCKER FOR AC1/AC2/AC3, and it is the only one: that building has no street address
on file. Not a key, not an API, not code — a data-entry gap on a real client building. Someone
with the real address needs to open Locations > test > edit and enter it (or use 'Get
coordinates' on the dashboard row if that prompts for one); geocode-backfill.js is safe to
re-run afterward (idempotent, only touches lat IS NULL rows) and will pin it immediately since
the key chain (server key -> geocoding-backend.googleapis.com -> Street View too) is now fully
live end-to-end. Also separately confirmed today: TASK-17's Street View gate on this same key
now passes (status: OK on a real probe), so once an address lands here, AC1-3 on both TASK-16
and TASK-17's AC1 close together.

Not fabricating an address for a real client building — owner/admin data entry, not mine to guess.
<!-- SECTION:NOTES:END -->
