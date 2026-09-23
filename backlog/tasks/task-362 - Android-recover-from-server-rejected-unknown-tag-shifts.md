---
id: TASK-362
title: 'Android: recover from server-rejected unknown tag shifts'
status: To Do
assignee: []
created_date: '2026-09-23 18:46'
labels: []
dependencies: []
references:
  - captures/company-workspaces/android-polish/verification/runtime-matrix.md
priority: high
type: bug
ordinal: 281000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-360 real emulator negative test: a syntactically valid timesheets.exe.xyz tag with unknown UUID creates a local pending open shift, while server returns unknown_location and DB stays 7 total / 0 open shifts. Manual finish then says the server has no such shift. Debug-only simulated finish leaves a pending row. This behavior predates the visual patch (handleTap and storage unchanged) and must not be hidden by false success or by deleting valid offline work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A server-rejected unknown location leaves a clear recoverable UI and does not trap the worker in an unfinishable shift.
- [ ] #2 Recovery cannot discard legitimate offline shifts or change server-authoritative pay and timeout semantics.
- [ ] #3 Real emulator tests cover unknown valid UUID, known verified zone, offline start and retry; new copy ships DE and EN.
<!-- AC:END -->
