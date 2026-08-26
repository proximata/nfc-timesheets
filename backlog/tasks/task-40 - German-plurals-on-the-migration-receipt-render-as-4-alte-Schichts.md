---
id: TASK-40
title: German plurals on the migration receipt render as '4 alte Schichts'
status: Done
assignee: []
created_date: '2026-08-04 17:46'
updated_date: '2026-08-26 20:30'
labels:
  - ios
  - i18n
  - bug
dependencies: []
priority: medium
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The migration receipt builds plurals by appending an English 's' in Swift, then passes that suffix into the German string. German does not pluralise by adding s, so a returning worker is greeted with broken German on the one screen whose whole job is to reassure them their old shifts were not lost.

NFCTimeSheets/NFCTimeSheets/MigrationReceiptView.swift:48
    Text("\(needsAdmin.count) old shift\(needsAdmin.count == 1 ? "" : "s") need your admin")
MigrationReceiptView.swift:35
    : "We cleaned up \(cleared.count) old record\(cleared.count == 1 ? "" : "s")")

Fix with the plural VARIATIONS that Localizable.xcstrings already supports, so the count and the
plural rule stay together in the catalogue where a translator can see them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Both strings use xcstrings plural variations, not a Swift-side 's' suffix
- [x] #2 German one/other forms correct, including the verb: 1 -> 'braucht', 4 -> 'brauchen'
- [x] #3 No format specifier is used to smuggle a plural suffix between languages
- [x] #4 NFCTimeSheets/checks/localisation-check.swift asserts the variations exist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed 2026-08-26. MigrationReceiptView.swift's two counted strings dropped the Swift-side
%@ 's' suffix (needsAdmin.count == 1 ? "" : "s") and now use single-%lld
LocalizedStringKey interpolation, so Localizable.xcstrings carries real plural.one/other
variations per language:
  "%lld old shifts need your admin" -> de one "...Schicht braucht...", other "...Schichten
  brauchen..." (verb agreement, not just the noun)
  "We cleaned up %lld old records" -> de one "...alten Eintrag...", other "...alte
  Einträge..." (replaces the old "Eintrag/Einträge" slash-form placeholder)
localisation-check.swift extended to validate BOTH shapes (flat stringUnit and
plural.one/other), require an 'other' form, and check placeholder types per variant - plus
a named assertion these two specific keys use a plural variation, not a flat string. RED
case run: reverting one key's de to a flat stringUnit makes both the placeholder-mismatch
check and the new named assertion fail; restored to green after. Full
NFCTimeSheets/checks/run.sh (11 checks) passes. Entitlements/pbxproj untouched (empty
diff).
<!-- SECTION:NOTES:END -->
