---
id: TASK-9
title: 'Remove manual scan button, add approach-tag UI'
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-27 07:32'
labels:
  - ios
  - ux
milestone: m-1
dependencies:
  - TASK-7
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace Tap to Start button with passive UI: illustration showing phone near tag, text Hold your iPhone near the tag. Keep hidden manual scan fallback (triple-tap).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default Log tab shows instructional UI, no prominent scan button
- [x] #2 Worker can start/end shift via background NFC tap only
- [ ] #3 Hidden manual scan accessible for troubleshooting
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC3 (hidden triple-tap manual scan) is dead, not a gap - grep for tripleTap/manualScan across NFCTimeSheets/*.swift finds nothing. Per decision-49's own history (the App Store rejection 90778 fix), the in-app manual NFC scanner was deliberately REMOVED later as part of switching the entitlement from NDEF to TAG-only. Left unchecked deliberately.
<!-- SECTION:NOTES:END -->
