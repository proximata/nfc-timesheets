---
id: TASK-24
title: v2 feature stubs (web + iOS)
status: Done
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-04 16:50'
labels:
  - web
  - ios
  - ux
milestone: m-3
dependencies:
  - TASK-23
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Grayed-out nav items with lock icon: Material Requests, P&L Dashboard, Contract Management, Building Analytics. Tooltip: Coming in v2. iOS app: same treatment in a tab or Settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Stub items visible in web sidebar nav
- [ ] #2 Stub items visible in iOS app
- [x] #3 Not clickable/navigable
- [ ] #4 Visually distinct (grayed, locked icon)
- [x] #5 Demo-friendly: stakeholder sees roadmap
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — SUPERSEDED BY REALITY. Closing as Done because the stubs are gone for the
right reason: all four features SHIPPED.

AC1/AC2/AC4 asked for greyed-out locked nav items. There are none, and there should not be:

  web/lib/nav.ts
  export const FUTURE_NAV: readonly NavKey[] = []
  /* EMPTY, and the empty case is load-bearing: everything that was here shipped. */

All four are now real screens, live:
  Material Requests -> /material-requests/ (200) + POST /material-requests (401)
  P&L Dashboard     -> /pl/ (200)           + GET  /admin/pl (401, registered)
  Contract Mgmt     -> /contracts/ (200)    + GET  /admin/locations/:id/contracts (401)
  Building Analytics-> /analytics/ (200)    + GET  /admin/analytics (401, registered)
Backing schema `005_v2_features.sql` is applied in production (schema_migrations, 2026-08-03
20:25). Frames: admin-material-requests.png, admin-pl.png, admin-contracts.png,
admin-analytics.png, and docs/media/admin-walkthrough.mp4.

AC3 and AC5 hold in the only sense left: nothing is a dead link, and the director sees the
roadmap because the roadmap arrived. The stub machinery is intact — adding a key to FUTURE_NAV
still announces a future screen — it simply has nothing to say.

Tracked as its own record: see the task for the four v2 screens shipping.
<!-- SECTION:NOTES:END -->
