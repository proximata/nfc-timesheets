---
id: TASK-254
title: Operator-only phones have no self-update path (Android)
status: To Do
assignee: []
created_date: '2026-08-24 17:44'
labels:
  - android
  - reliability
dependencies: []
priority: high
ordinal: 172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found 2026-08-24: UpdateSection in TimeSheetApp.kt is explicit — 'Lives ONLY here: Settings, worker-initiated, never on the tap or clock-out path.' WriteTagActivity.kt and VerifyZoneActivity.kt (the actual operator screens) have zero references to UpdateManager. An operator-only phone (e.g. Mister Clarity, op id 71 — never signs in as a worker) has NO self-service path to a fix. This bit us same-day: 0.5.6->0.5.7 shipped an operator-reachability fix, and an operator-only phone would have had no way to receive it without a manual sideload.

iOS note: iOS has no self-update mechanism at all (App Store rule), expected and correct — this task's iOS half is documentation only (what to tell an operator-only iPhone user), not code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 UpdateSection (or equivalent check/download/install) is reachable from the Betreiber? section on the sign-in screen and from WriteTagActivity/VerifyZoneActivity, without ever signing in as a worker
- [ ] #2 checkForUpdate/download/install reuse UpdateManager as-is — no second implementation
- [ ] #3 verified on emulator: an operator-only session (no worker sign-in) can see + trigger an update check
- [ ] #4 iOS: documented as N/A in the task, not built — self-update is against App Store rules; note what an operator-only iPhone should do instead (TestFlight / sideload)
<!-- AC:END -->
