---
id: TASK-295
title: 'Android: fun_shift_screen flag - forced black + procedural worker animation'
status: To Do
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 10:44'
labels:
  - android
  - decision-57
dependencies:
  - TASK-292
  - TASK-289
priority: low
ordinal: 213000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 flag OFF (default): ShiftRunningScreen pixel-identical to before this task; demo/check-app-not-wallpaper.mjs and demo/check-shift-screen-brand.mjs pass unchanged
- [ ] #2 flag ON: container forced to a true black background with legible light text, regardless of isSystemInDarkTheme()
- [ ] #3 flag ON: a procedural Compose Canvas + rememberInfiniteTransition animation (simple moving silhouette shapes, no new asset/library dependency) plays behind the content, never obscuring the state words or the clock
- [ ] #4 a new flag-ON assertion added to (or alongside) check-shift-screen-brand.mjs confirms the black is a FIXED black, not a Material-You-derived colour
- [ ] #5 android/checks/run.sh passes clean with the flag off; DE/EN strings.xml parity holds if any new strings are added
<!-- AC:END -->
