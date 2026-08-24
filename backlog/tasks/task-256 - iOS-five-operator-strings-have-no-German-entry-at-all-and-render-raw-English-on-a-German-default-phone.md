---
id: TASK-256
title: >-
  iOS: five operator strings have no German entry at all and render raw English
  on a German-default phone
status: To Do
assignee: []
created_date: '2026-08-24 19:05'
labels:
  - ios
  - i18n
  - operators
dependencies: []
priority: high
ordinal: 174000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: operator journey (Android live + iOS code-read), steps 'Read ContentView.swift SignInView.operatorSection sentence by sentence', 'Read WriteTagScreen.swift operatorSignInSection' and 'Read VerifyZoneScreen.swift operator-gate section'. iOS could not be driven — CoreNFC never runs in Simulator — so this is a source finding, but it was confirmed by loading Localizable.xcstrings as JSON and looking the exact literals up, not inferred.

MEASURED AT HEAD. These five keys have NO entry whatsoever in NFCTimeSheets/NFCTimeSheets/Localizable.xcstrings (not a missing de localization on an existing key — the key itself is absent), so SwiftUI falls back to rendering the raw English source string on a German-locale device:

  1. Operator? Write or test tags without signing in as a worker.        (ContentView.swift, sign-in screen footer)
  2. Test a tag                                                          (ContentView.swift, operator button)
  3. This phone is not signed in as an operator. Only operators can write tags.   (WriteTagScreen.swift gate)
  4. This phone is not signed in as an operator. Only operators can test a tag.   (VerifyZoneScreen.swift gate)
  5. Will write                                                          (WriteTagScreen.swift)

For contrast, the two neighbours ARE translated: 'Write a tag' -> 'Tag beschreiben' and 'Test scan' -> 'Testscan'. So the break is specifically at the operator ENTRY GATE, not in the deeper functional copy — everything past the gate (capacity refusal, read-only refusal, occupied/overwrite confirmation, verify-failed, lost-connection, the Tell-the-office report retry) is fully localized and mirrors Android feature for feature.

WHY IT MATTERS FOR UAT: this is the FIRST thing a signed-out operator sees, and an operator is a cleaner, not an engineer. decision-17 makes German the default. An English sentence sitting inside an otherwise German screen does not read as a language choice, it reads as a broken app. Android says the same thing in one clean German sentence ('Betreiber? Tags beschreiben oder pruefen, ohne sich als Mitarbeiter anzumelden.'), so a shop that hands out whichever phone is free sees two different products for the identical action.

SECONDARY, UNVERIFIED, DO NOT SCOPE-CREEP ON IT: the iOS project's knownRegions in project.pbxproj lists (en, Base) with no explicit 'de'. Whether that affects String Catalog locale resolution at runtime was NOT established. The five findings above stand regardless, because those keys have no de entry to resolve to in the first place. project.pbxproj is the owner's file — no agent edit (standing rule, decision-49).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All five listed strings have a de entry in Localizable.xcstrings and render German on a de-locale device
- [ ] #2 The footer sentence matches Android signin_operator_heading in meaning and register, so the same action reads the same on both platforms
- [ ] #3 Both gate sentences match Android write_needs_operator_to_write / the verify equivalent in meaning — including the clause that the screen reads no card at all until a code is entered
- [ ] #4 No English fallback remains on any screen reachable from the sign-in screen without a worker session, checked by walking every literal in ContentView SignInView.operatorSection, WriteTagScreen.swift and VerifyZoneScreen.swift against the catalogue
- [ ] #5 project.pbxproj is NOT edited by this task
<!-- AC:END -->
