---
id: TASK-8
title: Encode location ID in NDEF tag URI
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
labels:
  - ios
  - physical
milestone: m-1
dependencies:
  - TASK-2
priority: high
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NDEF URI becomes https://timesheets.exe.xyz/t?l=<LOCATION_UUID>. App parses URL on launch to identify location. Decouples from hardware UIDs for background reads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each physical tag has unique URI with its location ID
- [ ] #2 App correctly parses location from incoming universal link
- [ ] #3 Server /t landing page still works
<!-- AC:END -->
