---
id: TASK-290
title: 'iOS: Stop button next to the running clock + manual clock-in from idle screen'
status: To Do
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 10:36'
labels:
  - ios
  - decision-56
dependencies:
  - TASK-287
priority: high
ordinal: 208000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 idle screen (no shift running) has a clearly secondary 'start without a tag' action opening a building picker built from the already-cached roster; confirmation required before it calls POST /shifts/open with manual=true
- [ ] #2 ShiftScreen has a Stop button next to the ticking clock; confirmation dialog names the building and says this is flagged for office review; calls POST /shifts/close with manual=true, no location
- [ ] #3 server 422/409 responses on the manual-open path are shown with the SAME copy the tap path already uses, not a new generic error
- [ ] #4 ShiftScreen.swift's 'there is no in-app button and there must not be one' comment is updated to point at decision-56 rather than deleted, explaining why the two new paths are safe (flagged, not silent)
- [ ] #5 a debug-only mock/simulation mechanism (mirroring OperatorMockFlows.swift's pattern) covers both new flows with zero mock symbols surviving a Release build
- [ ] #6 checks/run.sh passes clean, Localizable.xcstrings gets the new keys in both languages, localisation-check.swift passes
- [ ] #7 git diff on NFCTimeSheets.entitlements, project.pbxproj, IPHONEOS_DEPLOYMENT_TARGET is EMPTY - confirm and quote it
<!-- AC:END -->
