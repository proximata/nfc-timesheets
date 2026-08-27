---
id: TASK-298
title: >-
  iOS: the shift-row pills are not localized - pill() takes String, so Text()
  renders verbatim English
status: To Do
assignee: []
created_date: '2026-08-27 11:12'
labels:
  - ios
  - i18n
  - bug
dependencies: []
priority: high
ordinal: 216000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-291 (decision-56 review gate), 2026-08-27.

MEASURED STATE. NFCTimeSheets/ContentView.swift:661
  private func pill(_ t: String, _ c: Color) -> some View { Text(t)... }
Text(_ content: S) where S: StringProtocol is the VERBATIM initializer. It never looks anything up. Every call site at :631-634 therefore ships its English literal on a German device:
  :631 pill("Manual", .blue)        <- NEW, decision-56
  :632 pill("In progress", .orange) <- pre-existing
  :633 pill("Auto-closed", .red)    <- pre-existing
  :634 pill("Corrected", .purple)   <- pre-existing

THE EVIDENCE THAT MAKES THIS CERTAIN, not a guess. A Release build was made and its compiled catalogue read:
  de.lproj/Localizable.strings contains "Manual" => "Manuell"   (hand-added by the decision-56 run)
  de.lproj/Localizable.strings contains NO entry for "In progress", "Auto-closed" or "Corrected"
Same function, same argument type, same call shape - the compiler extracted none of the four. The 'Manual' entry is unreachable dead weight, which is precisely why its presence made TASK-290 AC6 read as satisfied.

WHY NOTHING CAUGHT IT. checks/localisation-check.swift validates the CATALOGUE (every key has German) and says in its own header that it cannot prove the catalogue's key set matches what the compiler extracts. A literal that never becomes a key is invisible to it. This is the iOS twin of the web/app/tags/page.tsx German-only shipment (2026-08-24).

FIX. Change the signature to LocalizedStringKey:
  private func pill(_ t: LocalizedStringKey, _ c: Color) -> some View { Text(t)... }
All four call sites already pass literals, so they need no edit; add the three missing catalogue entries for In progress / Auto-closed / Corrected in BOTH languages in the same commit (project rule: no follow-up-commit exception). Check no other caller passes a runtime String - grep says there is none today.

MUST NOT REGRESS. decision-49: no agent edits NFCTimeSheets.entitlements or project.pbxproj. The project uses PBXFileSystemSynchronizedRootGroup so neither needs touching.

ACCEPTANCE EVIDENCE. Build Release, read de.lproj/Localizable.strings, and show all four keys present with German values; then confirm the shipped binary no longer needs the verbatim English literal on that row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pill() takes LocalizedStringKey, not String
- [ ] #2 In progress / Auto-closed / Corrected / Manual all have de AND en entries in Localizable.xcstrings
- [ ] #3 a Release build's de.lproj/Localizable.strings is quoted showing all four German values
- [ ] #4 checks/run.sh passes; entitlements and project.pbxproj diffs are EMPTY
<!-- AC:END -->
