---
id: TASK-23
title: Desktop-first layout + mobile blocker
status: Done
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-04 16:50'
labels:
  - web
  - ux
milestone: m-3
dependencies:
  - TASK-14
priority: high
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Below 1024px: full-screen message 'Admin designed for desktop.' Above: sidebar nav + main content. Nav items: Dashboard (map), Shifts, Workers, Locations, Payroll. 2-3 click max depth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mobile/tablet shows blocker, no admin UI leaks
- [x] #2 Desktop shows sidebar + content layout
- [x] #3 All functions reachable from sidebar in 1-3 clicks
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE.

AC1: web/components/DesktopOnlyGuard.tsx, threshold `DESKTOP_MIN_WIDTH_PX = 1024`
(web/lib/nav.ts). Below it the admin UI is REPLACED, not reflowed — live proof from the shipped
markup: the payroll page renders `<h1>Für den Computer gemacht</h1>` alongside
`<h1>Lohnabrechnung</h1>`, i.e. the blocker ships in the same document and takes over. decision-7.
AC2: web/components/AppShell.tsx + SidebarNav.tsx.
AC3: web/lib/nav.ts PRIMARY_NAV — 11 destinations, all one click from the sidebar:
  / (dashboard), /shifts/, /material-requests/, /workers/, /locations/, /clients/, /inventory/,
  /contracts/, /payroll/, /pl/, /analytics/.
Frames: all 11 admin-*.png stills, and docs/media/admin-walkthrough.mp4 (163 s) walks every one.

ONE deliberate exception, and it is correct: the client portal (/reinigung/) gets NO desktop
guard, because the person opening it is a client contact on a phone, not an admin. See
web/lib/nav.ts CLIENT_PORTAL_PATH and components/AppShell.tsx.
<!-- SECTION:NOTES:END -->
