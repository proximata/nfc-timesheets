---
id: TASK-172
title: >-
  The map info box takes no Escape and focus never follows the control that
  opened it
status: To Do
assignee: []
created_date: '2026-08-18 09:37'
labels:
  - a11y
  - map
dependencies: []
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, demo/audit-map-a11y.mjs on 127.0.0.1:8080, 28/32 — all four failures are this one box.

  FAIL map info box: focus moves INTO it            (focus stays on the Objektliste button)
  FAIL map info box: Tab is trapped                 (escaped at press 1)
  FAIL map info box: Escape closes it
  FAIL info box: reachable by Tab FORWARD from its own opener  (not reached in 30 presses)
  ok   info box: reachable at all with Shift+Tab    (7 presses, 6 of them Google's controls)
  ok   info box: the cross-links really are inside it            (11 links)

WHAT IS NOT BROKEN, so the fix does not overreach. The Objektliste IS a complete keyboard
path: audit-map-a11y section 5 shows the row and the pin open the SAME building's surface
for all 6 buildings, and the unpinned one still opens its whole object surface. Landing on
/?location=<uuid> from a cross-screen link is 5 Tabs using the skip link (20 without it).
So no function is keyboard-inaccessible and this is not a WCAG 2.1.1 or 2.1.2 failure.

WHAT IS BROKEN. The box is the only surface in the admin that does not keep the overlay
contract every Drawer and Modal keeps. A keyboard user presses Enter on 'Oeffnen' and
nothing happens where they are — the content appears UPSTREAM in DOM order, so forward Tab
never finds it, and Escape does not dismiss it.

MINIMUM FIX, in components/HomeMap.tsx: (1) Escape closes the box, (2) focus moves to the
box when it is opened by a keyboard activation and returns to the opener when it closes.
A full focus trap is NOT wanted — it is not a dialog and does not claim role=dialog.

AC
1. Escape closes the info box and focus returns to the control that opened it.
2. Activating 'Oeffnen' by keyboard moves focus into the box.
3. audit-map-a11y reports 32/32.
4. The phone bottom sheet, which already passes 8/8, does not regress.

MUST NOT REGRESS: decision-39; no cloud mapId (it makes the API ignore our styles).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Escape closes the info box and restores focus to the opener
- [ ] #2 keyboard activation of Oeffnen moves focus into the box
- [ ] #3 audit-map-a11y reports 32/32
- [ ] #4 the phone bottom sheet does not regress
<!-- AC:END -->
