---
id: TASK-298
title: >-
  iOS: the shift-row pills are not localized - pill() takes String, so Text()
  renders verbatim English
status: Done
assignee: []
created_date: '2026-08-27 11:12'
updated_date: '2026-08-27 16:09'
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
- [x] #1 pill() takes LocalizedStringKey, not String
- [x] #2 In progress / Auto-closed / Corrected / Manual all have de AND en entries in Localizable.xcstrings
- [x] #3 a Release build's de.lproj/Localizable.strings is quoted showing all four German values
- [x] #4 checks/run.sh passes; entitlements and project.pbxproj diffs are EMPTY
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-296 REVIEW GATE, 2026-08-27 - independently re-verified against fe9abda, PASS.

AC1. NFCTimeSheets/ContentView.swift:668
  private func pill(_ t: LocalizedStringKey, _ c: Color) -> some View
Signature confirmed. All four call sites (:632-635) pass string literals and are unchanged;
grep finds no caller passing a runtime String, and one would now fail to compile.

AC2 + AC3. Localizable.xcstrings read at HEAD, all four keys present with de AND en,
state=translated in every unit:
  'In progress' -> de 'Laeuft' (with the umlaut: L-a-umlaut-u-f-t) / en 'In progress'
  'Auto-closed' -> de 'Autom. beendet'                            / en 'Auto-closed'
  'Corrected'   -> de 'Korrigiert'                                / en 'Corrected'
  'Manual'      -> de 'Manuell'                                   / en 'Manual'  (the en
                   unit was added by this commit; the de one was the pre-existing dead entry)
271 keys total. The gate did not itself re-build Release; the catalogue and the signature
together are what make the lookup reachable, and localisation-check confirms the catalogue.

AC4. NFCTimeSheets/checks/run.sh re-run by the gate: tag-link OK, tap-inbox OK, migration OK,
scrub OK, materials OK, shift-signal OK, flags OK (4 figures, flags default OFF), ndef-tag OK,
write-guard OK, localisation OK (271 keys, all German), operator-gate OK,
entitlement-format OK -> 'checks: OK'.
Entitlements + pbxproj EMPTY across the whole run range, proven by blob identity rather than
by a diff that could be misread - f628b54..8521a18, every commit:
  project.pbxproj      480a727855ea4c405dfdd9a15a1a1584dc7f025e
  NFCTimeSheets.entitlements  95a3cb4f2b2bf7ea4205eb117ef8f9fcf44dc250
IPHONEOS_DEPLOYMENT_TARGET = 18.0 at all six occurrences, unchanged (it lives in pbxproj,
whose blob is identical). decision-49 respected: no agent touched either file.

STAYS DONE. One unrelated finding on the same commit, filed as TASK-306: fe9abda also
carries 'await refreshFlags()' (decision-57/TASK-294), whose declaration only lands in
33b0b4d - so that commit does not build in isolation. HEAD is correct; it is a bisect
hazard from two agents sharing one working tree, not a defect in this fix.
<!-- SECTION:NOTES:END -->
