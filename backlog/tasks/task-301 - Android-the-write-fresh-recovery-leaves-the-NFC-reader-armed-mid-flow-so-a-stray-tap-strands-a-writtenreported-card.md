---
id: TASK-301
title: >-
  Android: the write-fresh recovery leaves the NFC reader armed mid-flow, so a
  stray tap strands a written+reported card
status: In Progress
assignee: []
created_date: '2026-08-27 11:29'
updated_date: '2026-08-27 16:09'
labels:
  - android
  - decision-58
  - nfc
  - bug
dependencies: []
priority: high
ordinal: 219000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-297 review gate, not fixed there.

WHERE. android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifyZoneActivity.kt, readerWanted().

MEASURED CURRENT STATE. decision-58's write-fresh recovery added exactly one clause:
  freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true
and no clause for the other FreshStep states. The reassign flow this recovery is a copy of DOES have one:
  reassignStep !is ReassignStep.Idle && reassignStep !is ReassignStep.Done -> false
So while freshStep is Reporting, Naming, Submitting or Failed the reader stays armed, via 'selectedZone == null -> true' on the scan-first path and 'selectedZone?.isBound == true' on the worklist-first path.

WHAT BREAKS. onTag checks the fresh branch first, does not match those states, and falls through to the ordinary read -> handleScanFirst / handleRead. That reassigns scanStep / outcome away from Unreadable. FreshCardSection() is drawn only under 'scanStep is ScanStep.Unreadable' (line ~404) or 'outcome is VerifyOutcome.Unreadable' (line ~490), so the recovery section disappears from the composition while freshStep is still Naming. By that point the card is ALREADY WRITTEN and ALREADY REPORTED via POST /operator/tags, and no zone was created. The re-classified card lands on ScanStep.TagReported, which renders one sentence and offers no naming action, so the screen the operator is left on has no way back into the flow they were in.

WHY IT IS NOT THEORETICAL. The operator is at a door holding the phone in one hand and the card in the other, and the state it happens in is the one that takes the longest: typing the zone name.

FIX. One clause next to the existing one, mirroring reassign:
  freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true
  freshStep !is FreshStep.Idle -> false
Order matters: the arming arm must stay above the suppressing arm.

ACCEPTANCE EVIDENCE. A debug-build walk-through: enter the recovery from BOTH Unreadable states, reach Naming, present a card, and show the Naming step survives with FreshCardSection still drawn. Plus android/checks/run.sh green.

MUST NOT REGRESS. The AwaitingCard and WriteRefused states must still write (that is the only tap in this screen that writes, decision-58 section 3). The reassign flow's own gating must be left exactly as it is. No new server endpoint.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix applied + committed cffe9ca.

readerWanted() now reads:
  freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true
  freshStep !is FreshStep.Idle -> false
(arming arm above suppressing arm). Reassign gating untouched, no server change.

EVIDENCE DONE: android/checks/run.sh green end to end, incl. the new
checks/reader-armed-check.sh, which extracts readerWanted()'s body and asserts both
clauses AND their order; MUTANT=nosuppress and MUTANT=order each go red, so it is not
vacuous. (Source check because VerifyZoneActivity imports android.nfc and cannot be
compiled into the JVM checks.)

--- TASK-296 REVIEW GATE, 2026-08-27, re-read of cffe9ca ---

CONFIRMED, independently: the clause is present, in the right order (arming above
suppressing), reassign's own pair untouched, no server change. android/checks/run.sh
re-run by the gate: core-check OK, known-tags OK, tag-writer OK, manifest OK,
verify-no-shift OK, reader-armed OK (4 of 4 assertions, incl. the order one).
FreshStep has no Done state and submitFreshZone() -> selectZone() resets freshStep to
Idle BEFORE calling startReaderMode(), so the simpler '!is Idle' (vs reassign's
'!is Idle && !is Done') does not strand the post-create test scan. That part is right.

BUT THE FIX DOES NOT CLOSE THE REPORTED BUG. readerWanted() has exactly one caller -
the early return in startReaderMode() - and disableReaderMode is called only in
onPause() (:1080) and submitUnbind() (:1377). Nothing on the write-fresh path disables
anything, and there is no LaunchedEffect observing freshStep. The reader is already
enabled when AwaitingCard is entered, so on Reporting/Naming/Submitting/Failed it stays
enabled: a stray tap still reaches onTag(), still falls through to the ordinary read,
still re-classifies away from Unreadable, and FreshCardSection still leaves the
composition with the card written and reported. The task's own WHAT BREAKS paragraph is
still true on HEAD. What the commit did buy is the onResume() case (a backgrounded phone
no longer RE-arms mid-Naming), which is narrower than the field case described.

STAYS IN PROGRESS. Two open items: the disarm gap, filed as TASK-303 (with the same hole
in the reassign flow it was mirrored from), and the debug-build walk-through, still not
performed - no device/emulator run of the recovery from both Unreadable states.
<!-- SECTION:NOTES:END -->
