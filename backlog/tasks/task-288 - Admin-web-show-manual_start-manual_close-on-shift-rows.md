---
id: TASK-288
title: 'Admin web: show manual_start/manual_close on shift rows'
status: Done
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 11:13'
labels:
  - web
  - decision-56
dependencies:
  - TASK-287
priority: medium
ordinal: 206000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 wherever shifts are listed (web/app/shifts/page.tsx and anywhere else Shift rows render), a manual open and/or manual close gets a small visible marker, matching the existing isManualEntry pattern in web/lib/shifts.ts
- [x] #2 de.json/en.json get the new key(s), key-set parity holds (pnpm verify)
- [x] #3 a shift that is BOTH manual_start and manual_close, and one that is only one of the two, are visually distinguishable from each other and from a plain tap-tap shift
- [x] #4 pnpm verify passes clean
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
web commit aea4157. Shift type gains manual_start/manual_close; manualEnds() in lib/shifts.ts; /shifts origin column renders one .shift-manual-end line per manual end (start-only / close-only / both distinguishable, words not colour); dashboard on-site + recent rows show the same labels. Keys shifts.manualStart/manualClose in en.json+de.json. pnpm verify: check 'All checks passed.', biome 72 files 1 warning (pre-existing app/payroll/page.tsx:749 useOptionalChain, untouched), tsc clean, next build 18 routes.

TASK-291 gate 2026-08-27: all four ACs re-verified END TO END, not by reading - local :8199 stack, static export via PUBLIC_DIR, ops/screenshot.mjs logged in. /shifts renders tap/tap vs manual-start vs both distinguishably in greyscale; dashboard 'Gerade im Einsatz' and 'Zuletzt erfasste Schichten' show the same labels. pnpm verify exit 0, 'All checks passed.', 1 pre-existing biome warning (payroll:749, untouched).
DONE, with two follow-ups the ACs did not cover and which are NOT regressions of this task: TASK-299 (/shifts still prints 'Am Tag gescannt' above 'Start manuell erfasst' on the same row) and TASK-300 (payroll caveatManual counts isManualEntry only, so it under-reports the very population its sentence describes).
<!-- SECTION:NOTES:END -->
