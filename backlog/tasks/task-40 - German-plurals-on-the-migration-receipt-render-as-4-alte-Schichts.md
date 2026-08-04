---
id: TASK-40
title: German plurals on the migration receipt render as '4 alte Schichts'
status: To Do
assignee: []
created_date: '2026-08-04 17:46'
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
- [ ] #1 Both strings use xcstrings plural variations, not a Swift-side 's' suffix
- [ ] #2 German one/other forms correct, including the verb: 1 -> 'braucht', 4 -> 'brauchen'
- [ ] #3 No format specifier is used to smuggle a plural suffix between languages
- [ ] #4 NFCTimeSheets/checks/localisation-check.swift asserts the variations exist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 (agent 2) — OPEN. Real, reproducible, user-visible.

THE DEFECT, from NFCTimeSheets/NFCTimeSheets/Localizable.xcstrings:
  key: '%lld old shift%@ need your admin'
    en: '%1$lld old shift%2$@ need your admin'
    de: '%1$lld alte Schicht%2$@ braucht Ihre Verwaltung'
Swift passes 's' when count != 1, so German renders '4 alte Schichts braucht Ihre Verwaltung'.

TWO ERRORS IN ONE LINE, and the second is the one a native speaker notices harder:
1. 'Schichts' - the plural is 'Schichten'. The 's' is smuggled across the language boundary by
   %2$@, so the German translator never saw a plural decision to make.
2. 'braucht' is singular and never agrees. Even with the noun fixed it reads '4 alte Schichten
   braucht', where German needs 'brauchen'. Suffix-patching cannot reach the verb - which is
   exactly why the plural has to be a whole-string variation, not an appended fragment.

The sibling string at :35 dodges it with a different hack:
    de: 'Wir haben %1$lld alte%2$@ Eintrag/Einträge bereinigt'
'Eintrag/Einträge' is a slash-form - not wrong, but it is the placeholder style of a screen
nobody finished, and %2$@ still appends a stray 's' onto 'alte'.

STRUCTURAL, NOT A TYPO: 0 of 112 keys in Localizable.xcstrings use plural variations. Every
plural in the iOS app is currently either English-shaped or a slash-form.

WHY IT MATTERS MORE THAN A COSMETIC BUG: German is the DEFAULT language (decision-8), so this is
what real users see, not a fallback. The migration receipt exists to tell a worker their history
survived the upgrade - it is a trust screen, and it is written in visibly broken German.

RUNNABLE CHECK: NFCTimeSheets/checks/localisation-check.swift already scans for German nouns
(:105 checks 'Objekt', 'Schicht', 'Mitarbeiter'). Extend it to fail on a %@ adjacent to a
%lld-bearing noun.
<!-- SECTION:NOTES:END -->
