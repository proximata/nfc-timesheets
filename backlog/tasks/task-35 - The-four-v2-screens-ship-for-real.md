---
id: TASK-35
title: The four v2 screens ship for real
status: Done
assignee: []
created_date: '2026-08-04 16:53'
updated_date: '2026-08-04 16:53'
labels:
  - web
  - server
dependencies: []
priority: high
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retro-filed 2026-08-04 during backlog triage. Shipped in commit 609a174 (migration 005).

TASK-24 planned Material Requests, P&L, Contract Management and Building Analytics as greyed-out locked nav stubs. All four were built instead. This is the record of that, and the reason TASK-24 closed with an empty FUTURE_NAV.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Material requests: a worker can raise one, an admin can act on it
- [x] #2 P&L dashboard is live and reads period-scoped contract prices
- [x] #3 Contract management is live
- [x] #4 Building analytics is live
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EVIDENCE — pages and API routes, both checked against production.

  screen (200)            API route (401 = registered, vs 404 for an unknown path)
  /material-requests/     POST /material-requests, GET /material-requests/mine,
                          POST /material-requests/:id/seen, PATCH /admin/material-requests/:id
  /pl/                    GET  /admin/pl
  /contracts/             GET|POST /admin/locations/:id/contracts, DELETE /admin/contracts/:id
  /analytics/             GET  /admin/analytics

- Backing schema 005_v2_features.sql applied in production 2026-08-03 20:25 (schema_migrations).
- web/lib/nav.ts: FUTURE_NAV is [] and the SidebarNav "Kommt später" block renders only when it
  has entries — a heading over an empty list reads as a screen that failed to load.
- Frames: admin-material-requests.png, admin-pl.png, admin-contracts.png, admin-analytics.png.
  docs/media/admin-walkthrough.mp4 (163 s, 11 screens) pins /contracts/ at 139-145 s and
  /analytics/ at 148-151 s by sidebar highlight.
- Worker side: NFCTimeSheets/.../MaterialsView.swift + MaterialStore.swift, and
  android/.../data/MaterialStore.kt — material requests are queued on the phone and sent when
  the office enables them, so a worker is never told "not available".

Production usage of these tables is currently ZERO (material_requests=0, inventory_items=0,
location_contracts=0). The screens work; nobody has put data in them yet.
<!-- SECTION:NOTES:END -->
