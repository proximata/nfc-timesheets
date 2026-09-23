---
id: TASK-346
title: >-
  Android worker settings expose operator tools and another workers local
  history
status: Done
assignee: []
created_date: '2026-09-23 16:26'
updated_date: '2026-09-23 16:57'
labels: []
dependencies: []
type: bug
ordinal: 263000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User found Write or test tags in ordinary signed-in settings although operator entry belongs behind version taps. Shared-device emulator verification also exposed prior-worker Recent rows after account switch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Signed-in and signed-out operator entry uses five version taps and still requires operator authentication
- [x] #2 Local recent history and active shift UI are scoped to current worker without deleting queued work
- [x] #3 Real emulator verifies ordinary settings, version gate, and A to B to A account switching
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reuse VersionTapGate in settings, remove direct operator row, scope local UI reads and tap open-shift lookup by worker, verify actual emulator before commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Final latest-APK A to B to A pass: B sees neither A actual manual shift nor A DEBUG simulated row; returning A sees both again. Original worker 1 rows remain in SQLite. Evidence android-worker-b-final-isolated.png and android-worker-a-restored-final.png.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed direct Settings operator row and reused five version taps with unchanged operator auth. Scoped local history, open-shift lookup and boot notifications to current worker. Emulator A/B/A shows no foreign rows; read-only SQLite proves four prior rows belong to Legacy worker 1 and remain intact. Settings and signed-out fifth-tap gates verified. Debug build and focused JVM gate pass. Manual start uncovered separate building-versus-zone API bug; tracking separately.
<!-- SECTION:FINAL_SUMMARY:END -->
