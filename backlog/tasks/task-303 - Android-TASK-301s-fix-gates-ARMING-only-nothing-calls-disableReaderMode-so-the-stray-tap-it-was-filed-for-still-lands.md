---
id: TASK-303
title: >-
  Android: TASK-301's fix gates ARMING only - nothing calls disableReaderMode,
  so the stray tap it was filed for still lands
status: To Do
assignee: []
created_date: '2026-08-27 16:07'
labels:
  - android
  - decision-58
  - nfc
  - bug
dependencies: []
priority: high
ordinal: 221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-296 review gate re-reading the TASK-301 fix (cffe9ca), 2026-08-27. TASK-301 is NOT closed by that commit.

WHERE. android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifyZoneActivity.kt - readerWanted() (line ~1116), startReaderMode() (line ~1089), applyFreshWrite() (line ~656).

WHAT cffe9ca ACTUALLY DID, and it is correct as far as it goes: readerWanted() now carries the pair, in the right order -
  freshStep is FreshStep.AwaitingCard || freshStep is FreshStep.WriteRefused -> true
  freshStep !is FreshStep.Idle -> false
checks/reader-armed-check.sh proves both clauses and the order, and MUTANT=nosuppress / MUTANT=order each go red. All of that is real and was re-verified.

WHY IT DOES NOT FIX THE REPORTED BUG. readerWanted() is read at exactly ONE call site: the early return in startReaderMode(). It decides whether to CALL enableReaderMode. It never disables anything:
    private fun startReaderMode() {
        if (!operatorReady || !readerWanted()) return      <- returns, does not disable
        ...
        nfc.enableReaderMode(this, ::onTag, flags, null)
    }
disableReaderMode is called at exactly two sites in the whole file - onPause() (line 1080) and submitUnbind() (line 1377). Neither is on the write-fresh path. There is no LaunchedEffect and no other observer of freshStep, so no recomposition re-runs this.

THE SEQUENCE, unchanged by cffe9ca: scan-first (selectedZone == null) arms the reader -> card unreadable -> ScanStep.Unreadable -> operator taps the recovery -> startFreshCard() sets AwaitingCard and calls startReaderMode() (a no-op, already enabled) -> card tapped, written -> applyFreshWrite() sets freshStep = Reporting -> reader IS STILL ENABLED because nothing turned it off. A stray tap during Naming still reaches onTag(), still fails the AwaitingCard/WriteRefused test at the top, still falls through to the ordinary read, still re-classifies scanStep away from Unreadable, and FreshCardSection still leaves the composition with the card already written and already reported. That is TASK-301's own WHAT BREAKS paragraph, verbatim, on today's HEAD.

WHAT THE FIX DID BUY, and it is not nothing: onResume() calls startReaderMode(), so a phone backgrounded and reopened mid-Naming no longer RE-arms. That is a real but narrower case than the one the task describes (the operator standing at the door, typing a name, phone in hand, screen on).

THE SAME HOLE EXISTS IN THE REASSIGN FLOW it was copied from - reassignStep goes Picking -> AwaitingCard (armed) -> write -> Submitting with no disable - so 'mirrors reassign' faithfully reproduced reassign's defect. Fix both or neither; do not add a third copy.

FIX. Make the state change and the radio change the same act. Either call adapter?.disableReaderMode(this) at every site that moves freshStep/reassignStep into a suppressed state, or - preferable, one place instead of six - replace the two call shapes with a single syncReaderMode() that enables when readerWanted() is true and disables when it is false, and call THAT everywhere startReaderMode() is called today. Then readerWanted() becomes the single authority its own KDoc already claims it is.

ACCEPTANCE EVIDENCE. checks/reader-armed-check.sh extended so it is not satisfiable by a gate that only ever enables: assert that on the freshStep suppressed states a disable actually happens (source-level: the suppressing path must reach disableReaderMode, not merely return). Plus TASK-301's still-unperformed debug-build walk-through: enter the recovery from BOTH Unreadable states, reach Naming, present a card, and show FreshCardSection survives.

MUST NOT REGRESS. AwaitingCard and WriteRefused must still WRITE (decision-58 section 3) - that is the one tap in this screen that writes. The scan-first path (selectedZone == null) must stay armed. No new server endpoint. The reassign flow's own semantics (Done re-arms, because the screen has already moved to the new zone for its test scan) must survive whatever shape the fix takes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 syncReaderMode (or an equivalent) DISABLES the reader on the freshStep suppressed states, not merely declines to enable it
- [ ] #2 the same treatment applied to the reassign flow, since it has the identical hole
- [ ] #3 reader-armed-check.sh fails a build where readerWanted() is right but nothing disables - proven with a mutant
- [ ] #4 debug-build walk-through recorded: recovery entered from BOTH Unreadable states, Naming reached, card presented, FreshCardSection survives
- [ ] #5 android/checks/run.sh green
<!-- AC:END -->
