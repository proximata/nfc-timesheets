---
id: TASK-172
title: >-
  The map info box takes no Escape and focus never follows the control that
  opened it
status: Done
assignee: []
created_date: '2026-08-18 09:37'
updated_date: '2026-08-27 07:49'
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
- [x] #1 Escape closes the info box and restores focus to the opener
- [x] #2 keyboard activation of Oeffnen moves focus into the box
- [ ] #3 audit-map-a11y reports 32/32
- [x] #4 the phone bottom sheet does not regress
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, demo/audit-map-a11y.mjs against 127.0.0.1:8080 (keyed build, nfc_demo). No app code touched.

All four failures named in the description are GONE. Real stdout, section 2:
  ok   map info box: focus moves INTO it  - SECTION 'Aerztezentrum Landstrasse'
  ok   map info box: Tab LEAVES it - a non-modal popover may not trap focus (2 focusables) - left at press 3 onto BUTTON 'Vergroessern'
  ok   map info box: Escape closes it
  ok   map info box: focus RESTORED to the opener - BUTTON 'Oeffnen Aerztezentrum Landstrasse'
section 3:
  ok   info box: reachable by pressing Tab FORWARD from the control that opened it - 1 presses
  ok   info box: reachable at all with the keyboard (Shift+Tab) - 7 presses back
  ok   info box: the cross-links really are inside it - 10 links
AC1, AC2 checked from those lines. Note the 'Tab is trapped' assertion was deliberately INVERTED by the fix - the box is not a dialog, matching the description's 'a full focus trap is NOT wanted'.

AC4 checked - phone section 6 is 8/8 ok, including 'phone Objektpanel: Escape closes it', 'focus RESTORED to the opener' and 'body scroll released after close'.

AC3 LEFT UNCHECKED, and it is now unreachable as literally written: the script has grown to 34 assertions, not 32. Real footer:
  32/34 passed, 2 FAILED
    FAIL Objektpanel drawer: body scroll released after close
    FAIL map info box: body scroll released after close
Neither failure is this task: both are the desktop scroll-lock NOT being released after close, the same defect audit-overlays reports on four unrelated drawers (shifts:correct, shifts:create, workers:edit, workers:deactivate-confirm). The phone sheet passes the same assertion. Status left Done; the scroll-release defect needs its own task.
<!-- SECTION:NOTES:END -->
