---
id: TASK-314
title: >-
  write-tag-step-check passes over a button rendered under a never-true
  condition
status: To Do
assignee: []
created_date: '2026-08-29 12:29'
labels:
  - ios
  - checks
  - tech-debt
dependencies: []
ordinal: 232000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by review-gate-2 by ATTACKING the check that TASK-309 added, not by reading it.

The check (NFCTimeSheets/checks/write-tag-step-check.swift part 2) is genuinely non-vacuous
against five separate mutations - button deleted, button moved inside #if DEBUG, reset gutted,
button rewired to dismiss(), a 4th WriteTagStep case (compile error). All five go red. That is
real and it is the right shape.

But it brace-matches Buttons out of a panel's SOURCE. It has no notion of whether the Button is
REACHED. Wrapping the shipped control in a condition that is never true:

    if pendingId == "//never" {
        Button("Write another card") { resetForNewWrite() }
            .disabled(busy)
    }

leaves the check GREEN:
    zoneSection: exit via Button("Write another card")
    write-tag-step-check: OK      (exit 0)

That is exactly the failure class that shipped as TASK-309: a control that source-level
reasoning says is there and a thumb cannot reach. The check narrowed the hole; it did not
close it.

The only thing that catches this is NFCTimeSheetsUITests/WriteTagRestartUITests, and nothing
runs it. Its own header says 'NOT run by checks/run.sh, same as SmsDoorVisibilityUITests: that
script is Xcode-free and simulator-free on purpose. This is a hand-run proof.' So the sole
automated gate over the operator write flow is the one with the ceiling above.

NOT A BLOCKER TODAY, and that is measured, not assumed: the shipped Button at
WriteTagScreen.swift:216 is unconditional, and WriteTagRestartUITests was re-run independently
during this gate against a real simulator (iPhone 17, iOS 26.5) - green at HEAD in 30.1s, and
RED at WriteTagRestartUITests.swift:75 ('THE BUG: card 1 is done and the zone step is the whole
screen') when the button is removed in an isolated git worktree. The regression is genuinely
fixed. This task is about the NEXT edit to that file.

OPTIONS:
a) a simulator lane that runs the two UI tests (WriteTagRestartUITests, SmsDoorVisibilityUITests)
   somewhere other than a human's memory - Xcode Cloud already builds this project;
b) teach the check to refuse a Button nested inside any 'if'/'guard' inside a panel body, i.e.
   require the exit control at the panel's top brace level. Cheap, exact, and it would have
   caught the probe above. Over-strict by design: a conditional way out of the LAST panel is
   the bug, so forbidding it is the rule, not a false positive.
(b) is one function and no infrastructure. Prefer it, and treat (a) as separate.

REPRO: copy NFCTimeSheets/ to a temp dir, apply the wrapper above, then
  cd <tmp>/NFCTimeSheets
  cat NFCTimeSheets/WriteTagStep.swift checks/write-tag-step-check.swift > /tmp/c.swift && swift /tmp/c.swift
Expect exit 0. That is the bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 write-tag-step-check fails when the exit Button of any panel is nested inside a conditional rather than at the panel body's top level
- [ ] #2 the never-true-condition probe in the description is added as a red case and shown failing before the fix goes green
- [ ] #3 no change to WriteTagScreen.swift behaviour; checks/run.sh still exits 0 on unmodified HEAD
<!-- AC:END -->
