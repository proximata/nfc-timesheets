---
id: TASK-289
title: >-
  Android: Stop button next to the running clock + manual clock-in from idle
  screen
status: To Do
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 09:43'
labels:
  - android
  - decision-56
dependencies:
  - TASK-287
priority: high
ordinal: 207000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 idle screen (no shift running) has a clearly secondary 'start without a tag' action opening a building picker built from the already-cached roster; confirmation required before it calls POST /shifts/open with manual=true
- [ ] #2 running-shift screen has a Stop button next to the ticking clock; confirmation dialog names the building and says this is flagged for office review; calls POST /shifts/close with manual=true, no location
- [ ] #3 server 422/409 responses on the manual-open path (unbound zone, unverified place, already open elsewhere, wrong building) are shown with the SAME copy the tap path already uses, not a new generic error
- [ ] #4 TimeSheetApp.kt's 'there must not be one' comment is updated to point at decision-56 rather than deleted, explaining why the two new paths are safe (flagged, not silent)
- [ ] #5 the existing debug simulation mechanism covers both new flows (manual open success+refusal, manual close) with zero simulation code reachable in a release build
- [ ] #6 android/checks/run.sh passes clean, DE/EN strings.xml key-set parity holds
- [ ] #7 confirm only android/ files touched (git diff --stat)
<!-- AC:END -->
