---
id: TASK-263
title: >-
  iOS: the Test a tag button opens a screen that calls itself Testscan — one
  action, two names
status: Done
assignee: []
created_date: '2026-08-24 19:08'
updated_date: '2026-08-24 19:48'
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
- [x] #1 The operator test action has exactly ONE label, used for the sign-in-screen button and for the destination screen title
- [x] #2 The chosen label matches Android's verify_open / verify_title in meaning, so both platforms name the action the same way
- [x] #3 Any admin-panel copy that quotes the button label (TASK-259) is updated to the same wording in the same pass
- [x] #4 The Write a tag pair stays consistent as it is today
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED independently at f25e417 (not from build-agent claims).

AC1 OK - ONE label. /usr/bin/grep -F 'Test a tag': ContentView.swift:185 + :850 (NavigationLink), VerifyZoneScreen.swift:47 (.navigationTitle). Three sites, byte-identical. 'Test scan' returns ZERO hits anywhere under NFCTimeSheets/ and the key is deleted from Localizable.xcstrings.
AC2 OK - de value 'Tag pruefen' (umlaut u) == Android verify_open/verify_title 'Tag pruefen' (values/strings.xml:437-438; Android uses the ascii-oe transliteration project-wide). Meaning + register match. Nit only: EN source differs, iOS 'Test a tag' vs Android values-en 'Test tag'.
AC3 OK - web/messages/de.json:539 and en.json:539 both quote the CURRENT iOS label 'Test a tag'. de/en key parity re-diffed BY HAND (1337 keys each, de-only=[], en-only=[]); node web/scripts/check.mjs passes.
AC4 OK - Write pair untouched by this commit. ContentView.swift:184/:849 + WriteTagScreen.swift:58 all 'Write a tag' -> 'Tag beschreiben'. git diff 97a4d8c..HEAD touched only Localizable.xcstrings and VerifyZoneScreen.swift (1-line navigationTitle).

STRONGEST EVIDENCE: decompiled the BUILT bundle, not just the source catalogue. DerivedData/.../Debug-iphonesimulator/NFCTimeSheets.app/de.lproj/Localizable.strings (184 keys) resolves 'Test a tag' -> 'Tag pruefen' and contains no 'Test scan'. So the unified label really reaches a de device.

RESIDUAL, filed not blocking: de.json:539 tells a GERMAN reader to tap 'Test a tag' (the English source literal) while a German phone now renders 'Tag pruefen'. Both platforms are now 'Tag pruefen' in German, so the German admin sentence should collapse to ONE quoted label instead of naming Android and iOS separately. Not an AC3 failure - AC3 asked that the quoted label be the current one, and it is.
<!-- SECTION:NOTES:END -->
