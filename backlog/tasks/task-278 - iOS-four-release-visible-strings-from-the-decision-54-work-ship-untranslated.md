---
id: TASK-278
title: 'iOS: four release-visible strings from the decision-54 work ship untranslated'
status: Done
assignee: []
created_date: '2026-08-26 18:08'
updated_date: '2026-08-26 18:30'
labels:
  - ios
  - i18n
dependencies:
  - TASK-274
ordinal: 196000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-275 (review gate) in commit c7337fd. These literals are not keys in NFCTimeSheets/Localizable.xcstrings at all, so a German-default app renders the English source text:

  ContentView.swift:174        'Write or test tags'
  ContentView.swift:674        'Write or test tags'
  OperatorHomeScreen.swift:35  'Sign in as an operator to write and test tags. This never opens a shift.'
  OperatorHomeScreen.swift:59  .navigationTitle('Operator')

Two more are DEBUG-only and lower priority but should go in the same pass: VerifyZoneScreen.swift:98-99 and WriteTagScreen.swift:131-132 ('Simulate (debug builds only)', 'No NFC, no network. A simulator has neither.').

Verified by extracting every Text/NavigationLink/Button/navigationTitle literal at HEAD and at c7337fd~1 and diffing the missing sets: all four are NEW in c7337fd. The only pre-existing miss is DemoHooks.swift:106 (demo build only). The rest of the commit's ~37 new keys DID get German, so this is four misses rather than an absent pass.

WHY THE CHECK DID NOT CATCH IT: localisation-check.swift verifies that every key IN the catalogue has German. It cannot see a literal that was never extracted, and its own header says so. Extraction is 'xcodebuild -exportLocalizations -project NFCTimeSheets.xcodeproj -localizationPath /tmp/loc -exportLanguage de', then diff the <source> elements against the catalogue.

WORTH DOING IN THE SAME TASK: make that extraction a check, or the next screen repeats this. AGENTS.md's rule has no follow-up-commit exception and this is the second platform-side i18n miss on this project (web/app/tags/page.tsx, 2026-08-24, was the first).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 all four release-visible strings carry German in Localizable.xcstrings
- [x] #2 the two DEBUG-only strings are keyed too
- [x] #3 NFCTimeSheets/checks/ gains a check that fails when a source literal has no catalogue entry, RED case seeded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED 2026-08-26, commit 670a862. AC#1+#2: Localizable.xcstrings now carries German for 'Write or test tags', 'Sign in as an operator to write and test tags. This never opens a shift.', 'Operator', plus the two DEBUG-only 'Simulate (debug builds only)' / 'No NFC, no network. A simulator has neither.'; catalogue is 236 keys, all German. AC#3: localisation-check.swift gained a narrow source-literal extractor over the one-argument Text/Button/NavigationLink/Section/navigationTitle forms and fails when a literal has no catalogue entry. RED case run by me - deleting the 'Write or test tags' entry produced 'FAIL: ContentView.swift shows the literal Write or test tags and the catalogue has no entry for it' (twice, both call sites); restored, OK. CAVEAT recorded in the check's own header: it cannot see interpolated or variable-built literals, so it is a floor, not a proof - xcodebuild -exportLocalizations remains the real answer.
<!-- SECTION:NOTES:END -->
