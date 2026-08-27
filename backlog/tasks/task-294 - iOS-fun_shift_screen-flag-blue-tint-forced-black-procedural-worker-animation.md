---
id: TASK-294
title: >-
  iOS: fun_shift_screen flag - blue tint + forced black + procedural worker
  animation
status: To Do
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 10:44'
labels:
  - ios
  - decision-57
dependencies:
  - TASK-292
  - TASK-290
priority: low
ordinal: 212000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 flag OFF (default): ShiftScreen pixel-identical to before this task - existing green/red tint untouched
- [ ] #2 flag ON: tint is .blue instead of .green (.red for overdue unchanged); background forced black
- [ ] #3 flag ON: a procedural Canvas/TimelineView animation (simple moving silhouette shapes, no new asset/library dependency) plays behind the content, never obscuring the state words or the clock
- [ ] #4 checks/run.sh passes clean with the flag off; Localizable.xcstrings/localisation-check.swift updated if any new strings are added
- [ ] #5 git diff on NFCTimeSheets.entitlements, project.pbxproj, IPHONEOS_DEPLOYMENT_TARGET is EMPTY - confirm and quote it
<!-- AC:END -->
