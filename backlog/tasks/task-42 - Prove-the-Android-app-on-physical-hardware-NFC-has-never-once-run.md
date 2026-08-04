---
id: TASK-42
title: Prove the Android app on physical hardware - NFC has never once run
status: To Do
assignee: []
created_date: '2026-08-04 17:57'
updated_date: '2026-08-04 17:58'
labels:
  - android
  - nfc
  - risk
dependencies: []
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Android app assembles, installs and runs, and the whole journey was recorded - all of it on an EMULATOR. Android emulators have no NFC radio, so the ONE feature the product exists for has never executed on Android.

android/README.md:115 - 'adb shell pm list features' lists no android.hardware.nfc.
android/README.md:240 - the manifest uses NFC as a Play STORE FILTER only, so adb install bypasses it and an emulator with no NFC still installs and runs. That is exactly why this gap is easy to miss.

Everything downstream of the tap is proven. The tap itself is not.

BLOCKED ON THE OWNER for the hardware: a physical Android phone with NFC and a written tag.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app installed on a physical Android phone with an NFC radio
- [ ] #2 A real tag tap starts a shift with the app CLOSED (the foreground-dispatch path is not enough)
- [ ] #3 A second tap finishes that shift
- [ ] #4 The resulting row reaches production with the correct location UUID
- [ ] #5 The ongoing lock-screen notification confirmed on real hardware, not just the emulator
- [ ] #6 Behaviour recorded when NFC is switched OFF in system settings - the emulator cannot produce this state
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN, and this is the largest unproven claim on the board.

WHAT IS ACTUALLY PROVEN, and it is a lot: the Android client builds, installs, runs, signs in by
enrolment code, starts and finishes shifts, shows a real ongoing lock-screen notification, and was
recorded end to end (docs/media/android-journey.mp4, 132 s; both-devices.mp4, 144 s).

WHAT IS NOT PROVEN: the NFC tap. Every one of those runs was on the Pixel 7 AVD 'ts-demo'
(Android 16 / API 36, google_apis, arm64-v8a) - android/README.md:84. Emulators have no NFC radio.
So the shift starts in the recording were driven by the code path BEHIND the tap, not by a tag.

WHY THIS HID SO WELL - android/README.md:240: the NFC manifest entry is a Play STORE FILTER, not
an install-time requirement. 'adb install' bypasses it, so an emulator with no NFC installs and
runs the app happily and nothing anywhere says the radio is missing. Nothing fails; the feature is
simply never exercised. android/README.md:126 notes the permission prompt cannot occur either.

UNKNOWNS THAT ONLY HARDWARE SETTLES, and they are not cosmetic:
- Whether the intent filter actually matches the written tag. iOS matches by AASA against
  timesheets.exe.xyz; Android matches by intent-filter data spec. These are DIFFERENT mechanisms
  parsing the SAME tag, and only one of them has ever met the tag.
- Whether a tap wakes the app from fully-closed, which is the real workflow at 06:00 at a door.
- What happens when NFC is disabled in system settings - a state the emulator cannot enter.
- Whether the tag's NDEF record, written for iOS (TASK-6/TASK-8), is read identically by Android.

WHAT BREAKS IF NEVER DONE: an Android cleaner cannot clock in, and would discover it standing at a
building at dawn. Everything else about the Android app being finished makes this MORE dangerous,
not less: it looks shippable. Do not hand this build to a worker before one physical tap.

CHEAP FIRST TEST: one phone, one tag, one tap. If the intent filter is wrong it fails instantly
and the fix is a manifest line. Do not build anything else for Android until that tap works.

DEPENDS ON nothing in the repo - purely hardware access. Blocks any Android rollout, which makes
it a prerequisite of the Play Console work rather than the other way round.
<!-- SECTION:NOTES:END -->
