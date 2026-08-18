---
id: TASK-166
title: 'The new home on a phone: the list is the screen and the map is one tap away'
status: To Do
assignee: []
created_date: '2026-08-18 03:19'
labels:
  - ux
  - ia
  - map
dependencies:
  - TASK-155
documentation:
  - backlog/docs/MAP-HOME-SPEC.md
  - backlog/docs/IA-PLAN.md
priority: medium
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-28: the admin must work on a phone, because the director is often standing IN a building rather than at a desk. Spec: MAP-HOME-SPEC.md section 7.

On a phone the home screen IS the Objektliste and the map is one tap away. That is the honest form of 'a map on a phone is mostly a list':
 - map region COLLAPSED BY DEFAULT behind 'Karte anzeigen' (44 px target, aria-expanded). Choice remembered per session. Five labelled pins across Vienna at 390 px are unreadable, it spends a billed map load and mobile data in a stairwell, and the director on a phone is standing in ONE building, not surveying the portfolio.
 - map height when opened: 320 px fixed. NEVER 100vh, never 100dvh.
 - gestureHandling: 'cooperative' is MANDATORY - one finger scrolls the page, two fingers pan the map. 'greedy' (the PoC's setting) traps the page scroll and is the classic mobile map bug.
 - the Objektpanel becomes a FULL-HEIGHT MODAL BOTTOM SHEET with aria-modal=true and a focus trap (it covers the page, so it is modal here and non-modal on desktop). Close returns focus to the row that opened it.
 - cross-links: >=44 px, stacked, full width, each with its filter stated on a second line.
 - Objektliste rows become cards via the EXISTING .data-table transform. No bespoke card component.
 - no hover-only affordance anywhere; there is no hover on a phone.
 - the sidebar stays a horizontal strip, never display:none.

REGRESSION TO AVOID: review defect R1, sideways scroll between 768 and 1439 px, caused by table cells raising their min-content width. The five-column cap on the Objektliste is the guard. Verify at 390, 767, 1024, 1280 and 1440.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At 390 px one-finger vertical scrolling scrolls the PAGE, not the map, with the map expanded
- [ ] #2 The map is collapsed on first load at 390 px and expands to a 320 px region, never full viewport height
- [ ] #3 The Objektpanel at 390 px is a modal bottom sheet: focus is trapped inside it, Esc closes it, and focus returns to the row that opened it
- [ ] #4 No horizontal document scroll at 390, 767, 1024, 1280 or 1440 px - verified by screenshot at each width
- [ ] #5 Every interactive target in the panel and the list is at least 44 px, and no action is reachable only by hover
<!-- AC:END -->
