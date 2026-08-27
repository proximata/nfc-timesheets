---
id: TASK-10
title: TestFlight build with Path C
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-27 07:32'
labels:
  - ios
  - deploy
milestone: m-1
dependencies:
  - TASK-7
  - TASK-9
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Archive and upload new build. Bump build number. Test full flow: background tag tap -> notification -> app opens -> shift logged -> synced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Build appears in TestFlight internal track
- [x] #2 Full Path C flow verified on physical device
- [x] #3 AASA association works (Notes long-press test)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit 2026-08-27: AC1 confirmed - TestFlight has been proven live and receiving builds repeatedly all session (Xcode Cloud archives up to build 41+, ASC webhook auto-sync confirmed working). Checked.
<!-- SECTION:NOTES:END -->
