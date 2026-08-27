---
id: TASK-294
title: >-
  iOS: fun_shift_screen flag - blue tint + forced black + procedural worker
  animation
status: Done
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 16:10'
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
- [x] #1 flag OFF (default): ShiftScreen pixel-identical to before this task - existing green/red tint untouched
- [x] #2 flag ON: tint is .blue instead of .green (.red for overdue unchanged); background forced black
- [x] #3 flag ON: a procedural Canvas/TimelineView animation (simple moving silhouette shapes, no new asset/library dependency) plays behind the content, never obscuring the state words or the clock
- [x] #4 checks/run.sh passes clean with the flag off; Localizable.xcstrings/localisation-check.swift updated if any new strings are added
- [x] #5 git diff on NFCTimeSheets.entitlements, project.pbxproj, IPHONEOS_DEPLOYMENT_TARGET is EMPTY - confirm and quote it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-296 review gate, 2026-08-27: verified independently, PASS.
Flag OFF is untouched code: tint stays 'overdue ? .red : .green', background stays
'tint.opacity(0.14)'; @AppStorage defaults false, FeatureFlags.enabled() reads defaults.bool
(absent == false), refreshFlags() swallows every failure so an old server leaves the cache
standing. Overdue red is not flagged, per decision-57 section 3. The animation is inside
.background(...) of the ScrollView, so it is behind the content by z-order, at opacity 0.22
and accessibilityHidden - it cannot cover the state words. No new asset, no new dependency:
SwiftUI Canvas + TimelineView only. checks/run.sh green incl. the new flags-check
('OK (4 figures, flags default OFF)'). Entitlements + project.pbxproj byte-identical across
the whole run range (blob hashes quoted on TASK-298), IPHONEOS_DEPLOYMENT_TARGET 18.0
unchanged - AC5 satisfied. One unrelated finding on the neighbouring commit: TASK-306.
<!-- SECTION:NOTES:END -->
