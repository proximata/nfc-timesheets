---
id: TASK-256
title: >-
  iOS: five operator strings have no German entry at all and render raw English
  on a German-default phone
status: Done
assignee: []
created_date: '2026-08-24 19:05'
updated_date: '2026-08-24 19:53'
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
- [x] #1 All five listed strings have a de entry in Localizable.xcstrings and render German on a de-locale device
- [x] #2 The footer sentence matches Android signin_operator_heading in meaning and register, so the same action reads the same on both platforms
- [x] #3 Both gate sentences match Android write_needs_operator_to_write / the verify equivalent in meaning — including the clause that the screen reads no card at all until a code is entered
- [x] #4 No English fallback remains on any screen reachable from the sign-in screen without a worker session, checked by walking every literal in ContentView SignInView.operatorSection, WriteTagScreen.swift and VerifyZoneScreen.swift against the catalogue
- [x] #5 project.pbxproj is NOT edited by this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED independently at f25e417. 4 of 5 ACs hold; AC3 does NOT. Staying To Do.

AC5 OK (HARD GATE, decision-49) - git diff 97a4d8c..HEAD --numstat lists exactly TWO files: Localizable.xcstrings (+42/-2) and VerifyZoneScreen.swift (+1/-1). NFCTimeSheets.xcodeproj/project.pbxproj and NFCTimeSheets/NFCTimeSheets.entitlements: zero diff, and clean in the worktree too.

AC1 OK - Localizable.xcstrings parses as JSON (184 keys, sourceLanguage en). All five keys present with state=translated and real German. Verified BEYOND the source file: the compiled bundle DerivedData/.../Debug-iphonesimulator/NFCTimeSheets.app/de.lproj/Localizable.strings (built 21:44, commit 21:45) resolves all five. This also DISPROVES the task's own secondary worry - knownRegions is still (en, Base) with no de, yet de.lproj IS emitted, because a String Catalog derives its locales from the .xcstrings and not from knownRegions. No pbxproj edit is needed, now or later.

AC2 OK - footer de value is BYTE-IDENTICAL to Android values/strings.xml:41 signin_operator_heading: 'Betreiber? Tags beschreiben oder pruefen, ohne sich als Mitarbeiter anzumelden.'

AC4 OK - walked EVERY string literal in WriteTagScreen.swift, VerifyZoneScreen.swift and ContentView.swift operatorSection through the catalogue with interpolation normalised to the xcstrings percent-form. Every user-visible literal resolves to a de value, including the percent-lld ones ('Written: %@ - %lld of %lld bytes.', 'Too small for this tag: needs %lld bytes, ...'). The only unmatched literals are Swift COMMENTS ('a working tag', 'some text', 'stamp whatever was scanned', 'Who are you') and server error CODES never shown to a user (network, zone_mismatch, tag_unbound, unknown_location, unknown_zone). Catalogue-wide, only 'Name' and 'NFC TimeSheets' have de == en, both correctly.

AC3 FAILS - the AC requires both gate sentences to match Android IN MEANING, and names the clause explicitly: 'including the clause that the screen reads no card at all until a code is entered'. That clause is ABSENT, in the German AND in the English source.

  WriteTagScreen.swift:64  'This phone is not signed in as an operator. Only operators can write tags.'
    -> de: 'Dieses Telefon ist nicht als Betreiber angemeldet. Nur Betreiber koennen Tags beschreiben.'
  Android values/strings.xml:425 write_needs_operator_to_write:
    'Dieses Telefon ist nicht als Betreiber angemeldet. Tags koennen nur Betreiber beschreiben. Bitte den Betreiber-Code eingeben. Solange kein Code eingegeben ist, liest dieser Bildschirm gar keine Karte.'

  VerifyZoneScreen.swift:62 'This phone is not signed in as an operator. Only operators can test a tag.'
    -> de: 'Dieses Telefon ist nicht als Betreiber angemeldet. Nur Betreiber koennen einen Tag pruefen.'
  Android values/strings.xml:440 verify_needs_operator: same two extra sentences.

  Two sentences short on both screens. The German that WAS added is a faithful translation of the iOS English - the shortfall is in the English source string, so the fix is: extend both Swift literals with the 'Bitte den Betreiber-Code eingeben. Solange kein Code eingegeben ist, liest dieser Bildschirm gar keine Karte.' equivalent, then add the two new catalogue keys (the old keys become orphans and should be deleted, as 'Test scan' was). Both Swift files are in this task's allowed edit set; no pbxproj/entitlement change is involved. Everything else in this task is done - REMAINING WORK IS AC3 ONLY.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 19:53
---
VERIFIED independently at 5a71608. AC3 now holds; all 5 ACs pass. Task Done.

AC5 HARD GATE (decision-49) OK - git diff --stat for BOTH ranges f25e417..5a71608 and 97a4d8c..5a71608, scoped to NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj and NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements: EMPTY. git status --porcelain -- NFCTimeSheets/: clean. Both paths confirmed by find, so the scope was not a typo silently matching nothing. Commit touches exactly 5 files: Localizable.xcstrings, WriteTagScreen.swift, VerifyZoneScreen.swift, web/messages/de.json, web/messages/en.json.

AC3 OK - the missing clause is now in the ENGLISH SOURCE literal (which was the actual defect) and in the German, on both screens.
  WriteTagScreen.swift:64 'This phone is not signed in as an operator. Only operators can write tags. Please enter the operator code. Until a code is entered, this screen reads no card at all.'
    -> de 'Dieses Telefon ist nicht als Betreiber angemeldet. Nur Betreiber koennen Tags beschreiben. Bitte den Betreiber-Code eingeben. Solange kein Code eingegeben ist, liest dieser Bildschirm gar keine Karte.'
    vs android values/strings.xml:425 write_needs_operator_to_write - same three sentences, same order, same register.
  VerifyZoneScreen.swift:62 same shape, de 'Nur Betreiber koennen einen Tag pruefen. Bitte den Betreiber-Code eingeben. Solange kein Code eingegeben ist, liest dieser Bildschirm gar keine Karte.'
    vs android values/strings.xml:440 verify_needs_operator (Android says 'Zonen pruefen', iOS 'einen Tag pruefen' - matches each platform's own nav label, meaning identical).

No orphans - grep for the two OLD short literals across every *.swift: zero hits. The catalogue holds exactly two keys matching 'not signed in as an operator', both the new long ones, both state=translated. Each new Swift literal was extracted by regex and looked up as a catalogue key: hasOwnProperty true for both, so the byte match is proven, not eyeballed.

Checks re-run by me, not taken from the build report: Localizable.xcstrings JSON.parse OK (184 keys, sourceLanguage en); NFCTimeSheets/checks/localisation-check.swift -> 'OK (184 keys, all German)'; swiftc -parse on both touched files -> exit 0; node web/scripts/check.mjs -> 'All checks passed.'

Web copy (secondary fix) - de.json:539 / en.json:539 zoneVerifyStepsScan no longer names two platform labels; both now say 'Tag pruefen', which is what both apps' German build shows (android verify_open, iOS 'Test a tag' -> 'Tag pruefen'). de/en key parity exact: 1337 keys each, zero one-sided keys.

TWO COSMETIC CAVEATS, neither an AC and neither introduced here: (1) android values/strings.xml writes these German strings ASCII-transliterated (koennen/pruefen) while iOS uses real umlauts, though the file has 115 umlauts elsewhere - a pre-existing Android inconsistency; (2) en.json quotes the GERMAN label 'Tag pruefen' to an English reader, whose app would show 'Test tag' (android values-en:317) or 'Test a tag' (iOS). Defensible under decision-17 German default, but file it if an English-locale admin is ever a real user.
---
<!-- COMMENTS:END -->
