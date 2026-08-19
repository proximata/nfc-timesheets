---
id: TASK-173
title: >-
  Light-theme --state-unres is 4.34:1 under a WORD, and our own check scores it
  at the 3:1 tier
status: Done
assignee: []
created_date: '2026-08-18 09:37'
labels:
  - a11y
  - design
dependencies: []
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
COMPUTED from the parsed token file, both themes, not eyeballed.

  light  --state-unres on --bg-raised (#fff)     4.34:1
  light  --state-unres on --bg-base   (#fafafa)  4.16:1
  dark   the same pairs                          8.95:1 / 9.58:1   fine

globals.css paints WORDS with it:
    .badge.unres, .shift-state-unresolved, .material-stage-decide { color: var(--state-unres) }
'Nicht bestaetigt', 'pruefen', 'zu entscheiden' are text, so WCAG 1.4.3 asks 4.5:1 and the
light theme misses it on every screen that shows an unresolved shift or a material stage.

WHY IT WAS NOT CAUGHT. The two checks in the tree disagree about the tier for the SAME pair:
  demo/audit-contrast.mjs      need 3:1    'badge word + the 3px rule'   -> ok
  demo/audit-map-contrast.mjs  need 4.5:1  'a WORD, so body tier'        -> FAIL
The map audit is right. A badge is a word first and a graphical object second, and scoring
it as a graphic is what let 4.34:1 ship.

MEASURED FIX. --state-unres light is oklch(0.58 0.11 75) (#a07020). Solved in-browser over
both backdrops: L 0.55 (#976712) gives 4.92:1 on #fff and 4.63:1 on the base. L 0.56 and
0.57 do not clear both. Chroma and hue unchanged.

AC
1. --state-unres clears 4.5:1 on --bg-base AND --bg-raised in the light theme.
2. demo/audit-contrast.mjs scores --state-unres, --state-open and --state-corrected at the
   4.5:1 body tier, because all three paint a word; it goes RED if the token is put back.
3. Dark theme unchanged; demo/check-ia-greyscale.mjs still PASSes (colour stays the SECOND
   signal, the word carries the state).

Same run also measured, and NOT included here because they are Google's map geometry rather
than our surfaces: street-name labels 3.4:1 dark / 3.93:1 light against the road they sit
on (lib/map.ts #6c7178 / #7b8189). Separate call: it is context, not our data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 light --state-unres clears 4.5:1 on --bg-base and --bg-raised
- [ ] #2 audit-contrast scores the three state tokens at the 4.5:1 body tier and goes RED on the old value
- [ ] #3 dark theme unchanged and check-ia-greyscale still PASSes
<!-- AC:END -->
