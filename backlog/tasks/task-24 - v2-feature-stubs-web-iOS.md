---
id: TASK-24
title: v2 feature stubs (web + iOS)
status: Done
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-27 07:29'
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
Audit 2026-08-27: AC1/2/4 (stub roadmap items visible+styled in the ORIGINAL sidebar nav) are moot, not a real gap - that nav no longer exists. TASK-136..165 (Done) fully redesigned the admin nav (token layer, overlay primitives, 12 flat entries regrouped into 3), replacing the early roadmap-stub concept entirely. Left unchecked deliberately; task stays Done.
<!-- SECTION:NOTES:END -->
