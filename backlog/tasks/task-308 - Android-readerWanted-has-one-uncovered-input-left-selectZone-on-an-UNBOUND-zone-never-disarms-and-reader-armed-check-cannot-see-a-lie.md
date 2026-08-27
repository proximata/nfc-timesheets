---
id: TASK-308
title: >-
  Android: readerWanted() has one uncovered input left - selectZone() on an
  UNBOUND zone never disarms, and reader-armed-check cannot see a lie
status: To Do
assignee: []
created_date: '2026-08-27 17:42'
updated_date: '2026-08-27 17:42'
labels:
  - android
  - nfc
  - decision-54
  - bug
dependencies: []
priority: medium
ordinal: 226000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-303 review gate, 2026-08-27, while tracing every path from a suppressed state to disableReaderMode(). NOT introduced by 6dd27f7 - cffe9ca and everything before it behave identically. Filed so the last arm of readerWanted() gets the same treatment TASK-303 gave the two write arms.

WHERE. android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifyZoneActivity.kt - selectZone() l.1169, plus android/checks/reader-armed-check.sh.

1. THE UNCOVERED INPUT. After TASK-303 the radio follows readerWanted() for three of its four
inputs: freshStep and reassignStep through LaunchedEffect(freshStep, reassignStep) at l.363,
operatorReady through onResume (its only assignment, l.1078). The fourth, selectedZone, is
covered only by explicit calls - selectZone()'s BOUND branch, changeZone(), the bind success at
l.1459, and submitUnbind() which disables by hand at l.1395. The UNBOUND branch of selectZone()
calls loadBindLocations() and nothing else, and changes no LaunchedEffect key.

REPRODUCE. Open the verify screen with no zone picked: selectedZone == null -> readerWanted()
true -> onResume arms the reader. Tap an UNBOUND zone in the worklist (or reach one through the
scan-first classification at l.1233). readerWanted() now returns false via the final clause
(selectedZone?.isBound == true), and nothing disables. A card presented during BindStep.Picking
reaches onTag, falls past both write branches (freshStep/reassignStep are Idle), and lands in
handleRead() against a zone with no building - which the server answers 422 tag_unbound, because
activePlace INNER JOINs locations. Decision-54 §3 says that tap must be impossible by absence of
the callback, not refused after the fact.

SEVERITY: low, and that is why it is a separate task and did not block TASK-303's push. No card
is written on this path - onTag only writes while freshStep/reassignStep is AwaitingCard or
WriteRefused - so the worst outcome is an unnecessary round trip and a confusing message.

FIX. One line: call syncReaderMode() in selectZone()'s else-branch, alongside
loadBindLocations(). Do NOT add selectedZone as a third LaunchedEffect key without checking the
Done/selectZone interleaving in finishReassign (l.1327) first - selectZone() is called there
immediately before reassignStep = Done, and both already sync in the right order.

2. THE CHECK CANNOT SEE A LIE. reader-armed-check.sh is a source grep, and the TASK-303 review
found two mutants that keep it GREEN while the bug is live:
  - if (false) nfc.disableReaderMode(this)   - the token is present, the call is unreachable
  - LaunchedEffect(freshStep, reassignStep) { }  - the key line matches, the body does nothing
Both are 'a developer wrote a lie', not 'a regression crept in', so this is hardening and not a
hole in TASK-303. The cheap half is worth doing: assert the LaunchedEffect line also CONTAINS
syncReaderMode() (kills the empty-body mutant outright) and add both to the MUTANT= list at the
top of the script so the next reviewer inherits the evidence. The unreachable-call mutant is not
worth chasing with grep - note it in the script's header as a stated limit instead.

VERIFIED RED/GREEN so far (scratch tree, real source edits, sh checks/reader-armed-check.sh):
pre-fix file -> red; no-disable -> red; no LaunchedEffect -> red; LaunchedEffect(freshStep) only
-> red; if(false) -> GREEN; empty body -> GREEN.

MUST NOT REGRESS. The scan-first state (selectedZone == null) must stay armed - it is the whole
of decision-55 §2. AwaitingCard/WriteRefused must still write. No server change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 selectZone()'s unbound branch disarms the reader (source-traced, not asserted in a comment)
- [ ] #2 reader-armed-check.sh asserts the LaunchedEffect body CONTAINS syncReaderMode(); the empty-body mutant goes red and is listed in the MUTANT= header
- [ ] #3 the unreachable-call limit is written into the script header as a stated limit
- [ ] #4 scan-first stays armed and AwaitingCard/WriteRefused still write; android/checks/run.sh green
<!-- AC:END -->
