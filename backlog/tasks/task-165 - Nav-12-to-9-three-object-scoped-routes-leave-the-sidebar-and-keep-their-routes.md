---
id: TASK-165
title: >-
  Nav 12 to 9: three object-scoped routes leave the sidebar and keep their
  routes
status: Done
assignee: []
created_date: '2026-08-18 03:18'
updated_date: '2026-08-18 05:56'
labels:
  - ux
  - ia
dependencies:
  - TASK-163
documentation:
  - backlog/docs/IA-PLAN.md
priority: medium
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar is the last place the 'one screen per table' shape is still visible: twelve flat destinations, one per table, in the order the tables exist. Reasoning: decision-39 (PROPOSED). Plan: IA-PLAN.md section 2.2.

NEW SIDEBAR (9 entries):
  Uebersicht /, Schichten /shifts/, Material /material-requests/
  -- Stammdaten -- Objekte /locations/, Mitarbeiter /workers/, Kunden /clients/
  -- Geld -- Lohn /payroll/, Ergebnis /pl/
  -- pinned bottom -- Konto /account/

LEAVING THE SIDEBAR, KEEPING THEIR ROUTES: /contracts/, /analytics/, /inventory/. Each is object-scoped or catalogue-scoped and no journey in JOURNEYS.md section 8 starts by opening them cold. Each keeps inbound links that carry state:
  /contracts/ <- Objektpanel L5, /pl/ L23, /locations/ row L36, onboarding step 2
  /analytics/ <- Objektpanel L10, /pl/ flagged building
  /inventory/ <- /material-requests/ (already links there today), /pl/ material cost

/material-requests/ STAYS TOP-LEVEL and is deliberately not filed under Stammdaten: a worker is standing in a building WAITING on that queue, which makes it a today problem and not a catalogue one. That reasoning is already written in web/lib/nav.ts and must survive.

THE RISK IS A DEAD ROUTE. Guard it with a check, not with a promise: every admin route not in PRIMARY_NAV must have at least one inbound link in the BUILT export. One file (web/lib/nav.ts), reversible in a minute.

MUST NOT CHANGE: group labels are <p class=nav-heading>, NOT headings (a heading here would precede the page h1 in DOM order); aria-labelledby supplies the grouping; aria-current='page'; the FUTURE_NAV machinery with its load-bearing empty case; the sidebar stays a horizontal strip on phones and is NEVER display:none (mutation-tested, REDESIGN-REVIEW section 5 M4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PRIMARY_NAV has 9 entries; /contracts/, /analytics/ and /inventory/ are absent from it and all three routes still resolve
- [x] #2 A check asserts that every admin route outside PRIMARY_NAV has at least one inbound link in the built export, and it goes RED when that link is removed
- [x] #3 At 390 px the sidebar is still a scrollable strip with display:flex, never display:none, and all 9 entries are reachable
- [x] #4 Group labels are still <p>, not headings; aria-current='page' still marks the active route
- [x] #5 D12: a director reaches a building's contract periods from the Objektpanel in one click without using the sidebar
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
NAV_GROUPS is 9 entries. /contracts/, /analytics/ and /inventory/ left the sidebar and kept their routes - the build still emits all three.

How each stays reachable, recorded as DATA in lib/nav.ts (OFF_NAV_ROUTES) rather than as a comment, because web/scripts/check.mjs reads it:
  /contracts/  <- Objektpanel - /pl/ flagged row - /pl/ methodNoContract - /locations/ contract cell (both branches: an unpriced building links too, because that screen is what states what it does to the P&L) - /analytics/ panel
  /analytics/  <- Objektpanel
  /inventory/  <- /material-requests/ panel action (moved OUT of the paperwork drawer: a link only reachable by opening something else is not a way in) - the drawer hint

The check 'every route that left the sidebar keeps a way in' counts a link only in a file that is not the route's own page, and a named constant only when it is referenced beyond its definition, so a dead const left by a deletion does not pass for a way in. RED proved twice: pointing the panel's analytics link elsewhere, and putting /contracts/ back in the sidebar.

@390 the strip still carries all nine (check-dashboard-shifts, check-materials-account-login, both now asserting exactly 9 - an exact count, because >= 9 would also pass a sidebar that grew back).
<!-- SECTION:FINAL_SUMMARY:END -->
