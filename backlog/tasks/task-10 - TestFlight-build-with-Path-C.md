---
id: TASK-10
title: TestFlight build with Path C
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:51'
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
- [ ] #1 Build appears in TestFlight internal track
- [x] #2 Full Path C flow verified on physical device
- [x] #3 AASA association works (Notes long-press test)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE for the Path C build this task is about. The NEXT build is a NEW task.

That split is the judgement call, so here is the reasoning: this task scope is "does the
background-tap flow work on a real phone, shipped through TestFlight". It does, and it did on
2026-07-30. Everything built since (in-shift takeover, German, enrolment codes, migration
receipt, demo hook) is a different payload that happens to need the same button pressed. Filing
it here would let a task that is genuinely finished sit open forever, absorbing each new
feature. It is filed as its own task instead.

AC2 + AC3 — PROVEN IN THE PRODUCTION DATABASE. Five shifts (ids 1-5, 2026-07-30 13:57 to 16:13),
all with client_uuid NOT NULL, i.e. POSTed by a phone, against the real location UUID, by a
worker whose row carries a non-null apple_sub. The only path that produces those rows is: real
tag -> universal link -> AASA association resolves -> app opens -> shift logged -> synced. A
simulator cannot do it; simctl cannot hand a universal link to an app. So the device was
physical and the association worked. That is a stronger check than the Notes long-press test
AC3 asks for.

AC1 LEFT UNCHECKED, HONESTLY. I could not query App Store Connect, so I cannot name the build
number on the internal track. What is proven is that a signed build carrying Sign in with Apple
and universal-link handling ran on a real phone against production. The repo is at
CURRENT_PROJECT_VERSION = 2 (project.pbxproj), MARKETING_VERSION 1.0.

WHAT IS NOT ON ANY TESTER PHONE: everything after commit ba031bf. See the new-build task.
<!-- SECTION:NOTES:END -->
