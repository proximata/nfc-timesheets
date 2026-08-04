---
id: TASK-26
title: APNs prerequisites documentation
status: To Do
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-04 16:51'
labels:
  - docs
  - research
milestone: m-4
dependencies: []
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Document step-by-step: APNs key generation, entitlements, provisioning profile changes, server-side requirements (token vs cert based), Xcode config. Distinguish developer vs account owner actions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Written guide in docs/apns-setup.md
- [ ] #2 Covers Apple Developer portal + Xcode + server steps
- [ ] #3 Distinguishes developer vs account owner actions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — GENUINELY NOT DONE. Stays To Do.

AC1 fails outright: `docs/apns-setup.md` does not exist. `find . -iname "*apns*"` outside
node_modules returns this task file and nothing else. No document was ever written.

It is also not urgent, and the research already says why: push is only needed when the SERVER has
to reach a phone that is not running the app. Today the two out-of-app signals both work without
any push infrastructure —
  iOS:     the app icon BADGE (docs/media/ios-badge.png)
  Android: a real ongoing lock-screen notification (docs/media/android-notification.png)
and the 8h warning is a LOCAL notification scheduled on the phone at clock-in (TASK-12), which
needs no server and no APNs key.

research/android-path.md §6 covers the equivalent ground for FCM, opens with "first: do you need
it?", and compares FCM vs APNs effort and whether one backend can serve both. That is the honest
prior art; this task is the Apple-specific how-to that would be needed the day a server-initiated
push is actually wanted.

The real trigger for picking this up: wanting the office to be able to poke a phone — e.g. "your
shift was auto-closed, open the app" reaching a worker who never opens it. Until then this is
documentation for a capability nothing needs. LOW effort, LOW value today.
<!-- SECTION:NOTES:END -->
