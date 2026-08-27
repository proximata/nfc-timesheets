---
id: TASK-288
title: 'Admin web: show manual_start/manual_close on shift rows'
status: To Do
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 09:43'
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
- [ ] #1 wherever shifts are listed (web/app/shifts/page.tsx and anywhere else Shift rows render), a manual open and/or manual close gets a small visible marker, matching the existing isManualEntry pattern in web/lib/shifts.ts
- [ ] #2 de.json/en.json get the new key(s), key-set parity holds (pnpm verify)
- [ ] #3 a shift that is BOTH manual_start and manual_close, and one that is only one of the two, are visually distinguishable from each other and from a plain tap-tap shift
- [ ] #4 pnpm verify passes clean
<!-- AC:END -->
