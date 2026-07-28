---
id: TASK-12
title: 'iOS: local notification at 8h'
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
labels:
  - ios
milestone: m-2
dependencies: []
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shift start, schedule UNNotificationRequest for T+8h with payroll motivation message. Cancel if shift ended before 8h. Request notification permission on first shift start.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Notification fires at T+8h if shift still open
- [ ] #2 Notification cancelled if shift ended normally
- [ ] #3 Permission requested on first shift start, not app launch
- [ ] #4 Tapping notification opens app to resolution flow
<!-- AC:END -->
