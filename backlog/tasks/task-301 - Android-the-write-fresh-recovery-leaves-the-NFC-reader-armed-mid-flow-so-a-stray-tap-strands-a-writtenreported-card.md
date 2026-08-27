---
id: TASK-301
title: >-
  Android: the write-fresh recovery leaves the NFC reader armed mid-flow, so a
  stray tap strands a written+reported card
status: To Do
assignee: []
created_date: '2026-08-27 11:29'
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
