---
id: TASK-41
title: Cut the TestFlight build that carries everything shipped since 2026-07-30
status: To Do
assignee: []
created_date: '2026-08-04 17:56'
updated_date: '2026-08-04 17:57'
labels:
  - ios
  - deploy
dependencies: []
priority: high
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-10 proved the background-tap flow on a real phone through TestFlight, and is Done for that payload. Everything built SINCE that build is on nobody's phone.

Unshipped to testers: the in-shift takeover, the German localisation, enrolment codes, the on-device migration receipt, the NSUserActivity cold-launch fix, Sentry on iOS, and the DEBUG-only demo hook.

BLOCKED ON THE OWNER: archive + upload needs Xcode, the signing identity and App Store Connect. An agent cannot press those buttons.

Filed by triage agent 2, 2026-08-04, because TASK-10's notes promise this task exists and it did not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Build number bumped and archived against the current main
- [ ] #2 Build appears on the TestFlight internal track
- [ ] #3 On a PHYSICAL phone: tag tap -> shift logged, with the app fully closed
- [ ] #4 In-shift takeover verified on device, and the icon badge appears with the app backgrounded
- [ ] #5 German verified on a German-locale device - see the plural defect task before shipping
- [ ] #6 The DEBUG-only demo hook confirmed absent from the release build
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN. This is the successor TASK-10's notes said was 'filed as
its own task instead'. It was not; the earlier triage run ended first. Filing it now closes that gap.

WHY IT IS A SEPARATE TASK AND NOT A REOPENED TASK-10: TASK-10's scope was 'does the background-tap
flow work on a real phone, shipped through TestFlight'. It does, and it did on 2026-07-30 - proven
by shift rows 1-5 in production, all client_uuid NOT NULL. Reopening it would let a finished task
absorb every future release forever.

WHAT IS SITTING UNSHIPPED, by commit:
  da2c3c3  cold-launch tap fix, on-device migrations, Sentry both sides
  84da28f  NSUserActivity handling for the tag link
  bca7745  admin panel in German
  d1faa54  enrolment codes (decision-26)
  609a174  the four deferred features (decision-27)
  ba031bf  in-shift takeover + out-of-app signal
  d564af2  demo rig (DEBUG-only; must not appear in a release build)

WHAT BREAKS IF NEVER DONE: the cleaners keep running the 2026-07-30 build. Every fix since then -
including the cold-launch tap fix, which is a CLOCK-IN reliability fix - is inert on the devices
that actually clock people in. The gap between what is 'done' in the repo and what is on a phone
widens with each commit.

SEQUENCING: fix the German plural defect (TASK-40) BEFORE this build, or the first thing German
users see is '4 alte Schichts'. It is a one-string fix; do not ship a build to avoid it.

OUT-OF-APP SIGNAL, stated exactly: what works on iOS today is the icon BADGE. The Live Activity
ships INERT because no widget extension target exists. Do not claim otherwise in release notes.
<!-- SECTION:NOTES:END -->
