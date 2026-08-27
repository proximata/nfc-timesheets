---
id: TASK-303
title: >-
  Android: TASK-301's fix gates ARMING only - nothing calls disableReaderMode,
  so the stray tap it was filed for still lands
status: In Progress
assignee: []
created_date: '2026-08-27 16:07'
updated_date: '2026-08-27 17:42'
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
- [x] #1 syncReaderMode (or an equivalent) DISABLES the reader on the freshStep suppressed states, not merely declines to enable it
- [x] #2 the same treatment applied to the reassign flow, since it has the identical hole
- [x] #3 reader-armed-check.sh fails a build where readerWanted() is right but nothing disables - proven with a mutant
- [ ] #4 debug-build walk-through recorded: recovery entered from BOTH Unreadable states, Naming reached, card presented, FreshCardSection survives
- [x] #5 android/checks/run.sh green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW GATE (independent, 2026-08-27). VERDICT: the fix in 6dd27f7 is REAL. AC#1/#2/#3/#5 verified by reading the code and by running the checks, not by trusting the report. AC#4 confirmed genuinely blocked on hardware. Status stays In Progress for AC#4 only.

AC#1 - every freshStep suppressed state reaches an actual disableReaderMode(), traced in source:
  freshStep = Reporting (l.669) / Naming (l.683) / Submitting (l.698) / Failed (l.677,680,720,723)
  -> none of them calls syncReaderMode() itself, so the ONLY path is the reactive one:
  LaunchedEffect(freshStep, reassignStep) { syncReaderMode() } at l.363, inside the
  TimeSheetsTheme content lambda. That lambda is a non-inline @Composable (ui/Theme.kt:72), so
  reading the two states as LaunchedEffect keys registers snapshot reads in its own recompose
  scope -> any step change invalidates it -> keys differ -> effect relaunches -> syncReaderMode()
  -> readerWanted() false -> nfc.disableReaderMode(this) at l.1107. The path is code, not comment.
  Residual window is one frame + binder latency (was: the whole Naming screen, unbounded);
  onTag's existing belt-and-braces covers a tag dispatched inside that window.

AC#2 - the same single path covers reassign, because the same LaunchedEffect is keyed on
  reassignStep too: Loading (l.1246) / Picking (l.1250) / LoadFailed / Submitting (l.1301) /
  Failed (l.1311,1314) all hit the 'reassignStep !is Idle && !is Done -> false' clause and
  disable. Done still ARMS (falls through to the selectedZone clauses; finishReassign has
  already selectZone(fresh)-ed the new bound zone). Verified by reading, not by the comment.
  A mutant keyed on freshStep ONLY goes red (see M4 below), so AC#2 is checked, not assumed.

AC#3 - mutants run for real against a scratch tree (/tmp copy, real source edits, not only the
  script's own MUTANT= env simulation). Command: sh checks/reader-armed-check.sh in the copy.
  M1 pre-fix VerifyZoneActivity.kt (git show cffe9ca:...) + the NEW check
     = EXACTLY the mutant 'readerWanted() stays correct, nothing ever disables'
     -> exit 1, 'FAIL: syncReaderMode() not found - a start-only shape cannot disarm anything'
     and the five readerWanted() assertions above it all still print ok. That is the proof the
     old check was vacuous and the new one is not.
  M2 syncReaderMode kept, the disableReaderMode line replaced by a comment
     -> exit 1, 'FAIL: syncReaderMode() never calls disableReaderMode'
  M3 LaunchedEffect line deleted    -> exit 1, 'FAIL: nothing re-runs syncReaderMode()...'
  M4 LaunchedEffect(freshStep) only -> exit 1, same assertion (so AC#2 is gated too)
  KNOWN LIMITS of a source-grep check, both filed as TASK-308, neither a blocker:
  M5 'if (false) nfc.disableReaderMode(this)' stays GREEN, M6 'LaunchedEffect(freshStep,
  reassignStep) { }' with an empty body stays GREEN. They catch a liar, not a regression.

AC#5 - android/checks/run.sh re-run by the reviewer: exit 0 in 18s, tail:
    reader-armed-check: reading syncReaderMode() - the radio must MOVE, not merely decline
      ok  the extraction works: syncReaderMode() reads readerWanted()
      ok  the not-wanted branch DISABLES the reader (not just return)
      ok  ...and it still ARMS (the recovery must be able to write)
      ok  no start-only caller left: syncReaderMode() is the single actuator
      ok  a LaunchedEffect re-syncs on every freshStep AND reassignStep change
    reader-armed-check: OK
  Plus ./gradlew compileDebugKotlin -> exit 0 (the report claimed assembleDebug; recompiled
  independently, the LaunchedEffect import and the new function body do compile).

MUST-NOT-REGRESS, checked by reading:
  - AwaitingCard/WriteRefused still arm and still write: onTag l.1505 writes on the NFC thread
    and only THEN runOnUiThread { applyFreshWrite } changes the step, so no disable can land
    mid-write. WriteRefused stays armed for the next card.
  - scan-first idle-armed unchanged: selectedZone == null -> readerWanted() true; onResume
    (l.1083) and changeZone (l.1196) both sync. FreshCardSection still rendered from BOTH
    Unreadable states (l.412 scan-first, l.498 test scan) - untouched by the diff.
  - reassign Done still re-arms. No server change. git diff --name-only 2e224eb..HEAD =
    2 files, both android/ (VerifyZoneActivity.kt, checks/reader-armed-check.sh).

AC#4 STILL OPEN, and the emulator wall is real, not an excuse: adapter == null on an emulator
-> nfcState = UNSUPPORTED (l.1071) -> the when at l.376 renders scan_unsupported and never
calls ReadyBody(), so FreshCardSection (l.412/498) is not in the composition at all. A physical
NFC device is the only way to satisfy #4. Do not close TASK-303 on the strength of #1-#3+#5.

ADJACENT GAP FOUND, NOT INTRODUCED HERE, filed as TASK-308: selectZone() on an UNBOUND zone
(l.1169 else-branch -> loadBindLocations()) calls nothing and changes no LaunchedEffect key, so
a reader armed by the scan-first state stays armed while readerWanted() says false - the same
defect class, on the decision-54 §3 arm instead of the write arms. Pre-existing (cffe9ca and
earlier behave identically), read-only in effect (a tap there ends in a 422, no card is
written), so it does not block this push.
<!-- SECTION:NOTES:END -->
