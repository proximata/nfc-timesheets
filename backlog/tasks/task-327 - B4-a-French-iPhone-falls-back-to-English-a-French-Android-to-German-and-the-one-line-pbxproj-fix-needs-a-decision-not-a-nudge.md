---
id: TASK-327
title: >-
  B4: a French iPhone falls back to English, a French Android to German - and
  the one-line pbxproj fix needs a decision, not a nudge
status: To Do
assignee: []
created_date: '2026-08-29 23:04'
labels:
  - ios
  - i18n
dependencies: []
priority: medium
ordinal: 245000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED on both platforms, driven not read:
  fr-FR iPhone  -> ENGLISH
  fr-FR Android -> GERMAN
Cause: NFCTimeSheets.xcodeproj/project.pbxproj:203 developmentRegion = en, knownRegions = (en, Base)
at :205, so the built Info.plist carries CFBundleDevelopmentRegion = en and an unmatched locale
lands on English.

TWO TRAPS, both found the hard way this run:
1. It is NOT fixable from outside the project file. Setting CFBundleDevelopmentRegion=de in
   Info.plist and passing INFOPLIST_KEY_CFBundleDevelopmentRegion=de on the xcodebuild command
   line were BOTH overridden - the built plist still said en. The Info.plist edit was reverted
   rather than ship an inert key. Only project.pbxproj:203 + knownRegions actually moves it, and
   per decision-49 no agent edits project.pbxproj - it is the owner's click.
2. decision-61 section 2 says in as many words that iOS's sourceLanguage: en fallback is UNCHANGED
   by that decision. So flipping developmentRegion is a CHANGE OF DECISION, not a typo fix. It
   needs a new record that supersedes or amends decision-61, or the next person 'just fixes it'
   and quietly contradicts an accepted decision.

ALSO, correcting a claim both lane reports state flatly: Android's German fallback is NOT
unconditional. With a locale LIST of [fr-FR, en-US] - an ordinary phone that ever had English as a
secondary - Android renders ENGLISH. Reproduced on the emulator. Only a sole non-de, non-en locale
falls back to German. Whatever is decided should be written against that fact, not the simplified one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a decision record decides whether an unmatched locale gets German or English, on both platforms
- [ ] #2 if German: the owner edits project.pbxproj developmentRegion and knownRegions, no agent does
- [ ] #3 verified by driving a fr-FR device on both platforms, including the [fr-FR, en-US] list case on Android
<!-- AC:END -->
