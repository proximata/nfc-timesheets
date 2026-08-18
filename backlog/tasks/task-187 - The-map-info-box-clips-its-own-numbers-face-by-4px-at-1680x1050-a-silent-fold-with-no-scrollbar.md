---
id: TASK-187
title: >-
  The map info box clips its own numbers face by 4px at 1680x1050: a silent fold
  with no scrollbar
status: To Do
assignee: []
created_date: '2026-08-18 21:16'
labels:
  - a11y
dependencies: []
priority: medium
ordinal: 105000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED while verifying TASK-177/178/179, and NOT caused by them. `demo/check-map-home.mjs` has ONE failing assertion against a build of HEAD, deterministically, twice:

  FAIL info box: at rest the NUMBERS fit — nothing in the box is hidden behind a silent fold
         map-info-face 221/225 oy=auto mh=none txt=Gerade vor OrtElif Demir, seit 10:13 — ü

`.map-info-face` is 221px tall and holds 225px of content: FOUR pixels of the numbers face are behind an overflow with `overflow-y: auto` and macOS overlay scrollbars, which are invisible until something scrolls. The clipped strip is the bottom of the last line — the `field-hint` reading 'Zeiten bezogen auf HH:MM Uhr…', the sentence that dates every elapsed time in the box.

It is a CLAMP artefact, not a content-length one. The box is sized against the map, and the fold appears when the map is 346px tall (box 454→777 inside map 443→789, the check's own window of 1680x1050). A probe at 1680x1000 with the same building, the same pin and the same eleven links measures the face at 225/225 with nothing below the fold — four pixels of map height is the whole difference between fitting and not.

WHY IT MATTERS MORE THAN 4px. This box is the one the redesign chose over the drawer for a pinned building (IA-PLAN §9). Its expander is the fix for defect V1, where ten cross-links were reachable by scrolling a box that showed no scrollbar — the exact mechanism here, one size smaller. Any building whose face is a line taller (a longer worker name, a wrapped contract line, German plural forms) hides a whole row by the same route.

PRE-EXISTING: reproduced identically at c41d33f, before the reach commit and before the money commits, so it dates from 590077f, which was never looked at in a browser.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 demo/check-map-home.mjs exits 0 against a keyed build of HEAD on seeded nfc_demo
- [ ] #2 At rest the numbers face has no hidden overflow at 1680x1050 AND at 1680x1000 — the fix is a layout one, not a viewport the check happens to avoid
- [ ] #3 Nothing is deleted from the face to make it fit: the on-site line, the five numbers and the 'Zeiten bezogen auf' hint are all still rendered
- [ ] #4 The box still fits inside the map rectangle, collapsed and expanded, and all ten cross-links still land inside it when expanded
- [ ] #5 The negative case is exercised: shrinking the face's clamp by a few pixels puts the check back to red
<!-- AC:END -->
