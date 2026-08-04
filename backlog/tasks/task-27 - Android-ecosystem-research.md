---
id: TASK-27
title: Android ecosystem research
status: Done
assignee: []
created_date: '2026-07-28 13:51'
updated_date: '2026-08-04 16:50'
labels:
  - docs
  - research
milestone: m-4
dependencies: []
priority: high
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Research: Kotlin vs Java, Android Studio on macOS, NFC background reading, FCM push notifications, Google Play distribution, cross-platform options (KMP/RN/Flutter). Include honest trade-offs and recommendation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Written guide in docs/android-research.md
- [x] #2 Covers language, IDE, NFC, push, distribution
- [x] #3 Recommendation with reasoning
- [x] #4 Cross-platform assessment
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE. The research exists and was ACTED ON, which is the strongest evidence.

AC1: the document is `research/android-path.md` (not docs/android-research.md — the path moved,
the deliverable did not). Companion: research/android-and-white-label-plan.md.
AC2, by section: §2 Kotlin vs Java; §3 tooling on macOS incl. Apple Silicon emulator and physical
device debugging; §4 NFC — background reading, intent filters vs universal links, Android 16/17
gotchas, assetlinks.json vs AASA; §6 push (FCM vs APNs, and "first: do you need it?"); §7 Play
Console tracks and the 12-tester rule.
AC3/AC4: §1 recommendation summary, §8 cross-platform assessment, §5 NFC comparison table.

It changed decisions rather than sitting on a shelf:
- decision-27 came straight out of §7 — personal Play account, internal testing track, and the
  12-tester/14-day gate does not bind because internal testing has no requirement at all.
- decision-26 (enrolment codes instead of a third-party sign-in) came out of the identity gap.
- The `assetlinks.json` served live today with an EMPTY fingerprint array is §4.4 advice taken
  literally: ship the file at the right URL now, fill it when a signing key exists.
- An Android client was then actually built (android/).

The research is settled. What it recommended is NOT all done — see the Android tasks.
<!-- SECTION:NOTES:END -->
