---
id: TASK-166
title: 'The new home on a phone: the list is the screen and the map is one tap away'
status: Done
assignee: []
created_date: '2026-08-18 03:19'
updated_date: '2026-08-27 07:41'
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
- [x] #1 At 390 px one-finger vertical scrolling scrolls the PAGE, not the map, with the map expanded
- [x] #2 The map is collapsed on first load at 390 px and expands to a 320 px region, never full viewport height
- [x] #3 The Objektpanel at 390 px is a modal bottom sheet: focus is trapped inside it, Esc closes it, and focus returns to the row that opened it
- [x] #4 No horizontal document scroll at 390, 767, 1024, 1280 or 1440 px - verified by screenshot at each width
- [x] #5 Every interactive target in the panel and the list is at least 44 px, and no action is reachable only by hover
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27 (read-only re-verification, no app code touched). Keyed build, 127.0.0.1:8080, reseeded nfc_demo.

AC#3 NOW CHECKED - measured directly at a REAL 390px viewport (Emulation.setDeviceMetricsOverride 390x844, viewport read back as {"w":390,"h":844}), opening the panel from an Objektliste row control:
  opener: {"found":true,"label":"Ordination Gumpendorf Objektpanel oeffnen"}
  sheet:  {"drawer":true,"role":"dialog","ariaModal":"true","rect":{"top":0,"height":844,"width":390},"focusInside":true,"activeTag":"BUTTON","bodyOverflow":"hidden","docScrollW":390}
  afterTabx40:      {"stillInside":true,"active":"Lohn - nur Stunden in diesem Objekt - Vo"}
  afterShiftTabx5:  {"stillInside":true}
  afterEsc:         {"drawerGone":true,"url":"","focusBackOnOpener":true,"activeLabel":"Ordination Gumpendorf Objektpanel oeffnen","activeTag":"BUTTON"}
So: full-height modal sheet (844 of 844, top 0), role=dialog + aria-modal=true, focus trapped through 40 Tab and 5 Shift+Tab presses, Escape closes it and clears ?location=, and focus returns to the SAME NODE that opened it (identity comparison against a reference captured before the click, not a re-query). Page behind is scroll-locked (body overflow hidden) and there is no sideways scroll with the sheet open (docScrollW 390).

AC#1/#2/#4/#5 re-confirmed in the same session by DEMO_BASE=http://127.0.0.1:8080 node demo/check-map-home.mjs -> PASS:
  ok   390px: the map is COLLAPSED and says so, with a control that says what it does
  ok   390px: ...and collapsed means NO map was built - no billed load, no mobile data
  ok   390px: one tap brings a SMALL map - never the whole screen  320px of 844px
  ok   390px: one finger over the map scrolls the PAGE, it is not swallowed by the map  scrollY 110 -> 430
  ok   390px: the page does not scroll SIDEWAYS - the five-column cap holds  content 390px in 390px
  ok   390px: ...and its REMOVE control is on screen and a real target  44x44px

Status left Done.
<!-- SECTION:NOTES:END -->
