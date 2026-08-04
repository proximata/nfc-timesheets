---
id: TASK-9
title: 'Remove manual scan button, add approach-tag UI'
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:47'
labels:
  - ios
  - ux
milestone: m-1
dependencies:
  - TASK-7
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace Tap to Start button with passive UI: illustration showing phone near tag, text Hold your iPhone near the tag. Keep hidden manual scan fallback (triple-tap).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Default Log tab shows instructional UI, no prominent scan button
- [x] #2 Worker can start/end shift via background NFC tap only
- [ ] #3 Hidden manual scan accessible for troubleshooting
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, with ONE acceptance criterion deliberately reversed.

AC1 + AC2: commit e4ac6e2 "iOS: drop the in-app NFC scanner, fixing App Store error 90778". No
CoreNFC reader session survives in NFCTimeSheets/ — ContentView.swift keeps only the comment
recording where the button used to be. The Log screen is the passive "hold your phone to the tag
by the entrance to start" instruction (string present in Localizable.xcstrings, both locales).
Frames: `docs/media/before-ios-shift.png` and `docs/media/ios-journey.mp4`.

AC3 — "hidden manual scan accessible for troubleshooting" — WAS NOT BUILT, and will not be.
Apple rejected the build (error 90778) over the NFC entitlement the fallback required. The
scanner was removed rather than re-entitled. Leaving this AC unchecked is the honest record.
Consequence to know: if a tag is unreadable there is no in-app workaround; the office fixes it
by editing the shift in the admin panel (PATCH /admin/shifts/:id, live).

There is also no in-app clock-OUT button, by design (see the in-shift takeover): the tag is the
only way to end a shift, so two mechanisms can never disagree about somebody hours.
<!-- SECTION:NOTES:END -->
