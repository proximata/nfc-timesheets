---
id: TASK-7
title: 'iOS: handle background NFC launch via universal link'
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
labels:
  - ios
milestone: m-1
dependencies:
  - TASK-4
  - TASK-6
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) handler. Parse location ID from URL query param. Trigger start/stop shift logic. No second NFC scan needed — location encoded in URI.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tapping phone to NDEF tag without app open shows iOS notification
- [ ] #2 Tapping notification opens app and starts/stops shift
- [ ] #3 No manual Scan button tap required
- [ ] #4 Works on iPhone XS and newer
<!-- AC:END -->
