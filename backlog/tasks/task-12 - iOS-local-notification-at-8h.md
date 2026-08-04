---
id: TASK-12
title: 'iOS: local notification at 8h'
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
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
- [x] #1 Notification fires at T+8h if shift still open
- [x] #2 Notification cancelled if shift ended normally
- [x] #3 Permission requested on first shift start, not app launch
- [x] #4 Tapping notification opens app to resolution flow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE in the shipped source.

- NFCTimeSheets/NFCTimeSheets/ShiftSignalCenter.swift: `scheduleLadder(for:center:)` builds
  UNNotificationRequests; `ShiftSignal.autoCloseAfter = 8 * 3600`.
- AC3: `requestAuthorizationIfNeeded()` is called from ShiftScreen.swift:75, i.e. on the shift
  screen, NOT at app launch.
- AC1/AC2: the ladder is scheduled on start and torn down when the shift closes.
- AC4: the copy is written for exactly that — de: "Ihre Schicht bei %@ hat 8 Stunden erreicht und
  wurde automatisch beendet. Öffnen Sie die App und bestätigen Sie, wann Sie tatsächlich fertig
  waren – sonst wird sie nicht bezahlt." (Localizable.xcstrings), and an unresolved shift always
  opens the resolver sheet (ContentView.swift).

Out-of-app signal that genuinely works on iOS today is the icon BADGE
(`docs/media/ios-badge.png`). The Live Activity ships INERT — no widget extension target exists.
Filed as its own task; nothing here claims otherwise.

Caveat carried by every iOS item: this is in the repo, not necessarily on a tester phone. See
the TestFlight build task.
<!-- SECTION:NOTES:END -->
