---
id: TASK-263
title: >-
  iOS: the Test a tag button opens a screen that calls itself Testscan — one
  action, two names
status: To Do
assignee: []
created_date: '2026-08-24 19:08'
labels:
  - ios
  - i18n
  - ux
  - operators
dependencies:
  - TASK-256
priority: medium
ordinal: 181000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: operator journey, step 'Read VerifyZoneScreen.swift operator-gate section and screen title'. Code-read only — CoreNFC does not run in Simulator.

MEASURED AT HEAD in Localizable.xcstrings: the sign-in screen's button literal is 'Test a tag', which has NO entry in the catalogue at all. The screen it opens has navigationTitle 'Test scan', which DOES have a German entry and renders 'Testscan'. So on a German phone the operator taps an English button and lands on a German screen with a third wording. Its sibling is consistent: the button 'Write a tag' and its destination both resolve to 'Tag beschreiben'.

Android has no such drift: verify_open and verify_title are both 'Tag pruefen' — one string, reused for the button and the activity title.

WHY IT MATTERS FOR UAT: it is small, and it costs most for exactly the user who can least afford it — someone who is not fluent in the app's vocabulary and is checking, mid-tap, that they opened the right thing. Every extra name for the same action is one more thing to be unsure about while standing at a door.

RELATIONSHIP TO TASK-256: TASK-256 adds the missing German for 'Test a tag'. This task is the wording decision that has to be made at the same time — pick ONE label for the action and use it for the button, the navigation title and any reference to it in admin copy (see TASK-259, which quotes the phone's button label back to the owner). Do them together; splitting them guarantees the German lands and the drift stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The operator test action has exactly ONE label, used for the sign-in-screen button and for the destination screen title
- [ ] #2 The chosen label matches Android's verify_open / verify_title in meaning, so both platforms name the action the same way
- [ ] #3 Any admin-panel copy that quotes the button label (TASK-259) is updated to the same wording in the same pass
- [ ] #4 The Write a tag pair stays consistent as it is today
<!-- AC:END -->
