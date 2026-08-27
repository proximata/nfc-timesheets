---
id: TASK-306
title: >-
  Commit fe9abda (TASK-298) carries a decision-57 line whose function does not
  exist yet, so that commit does not build
status: To Do
assignee: []
created_date: '2026-08-27 16:08'
labels:
  - ios
  - process
  - git
dependencies: []
priority: low
ordinal: 224000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-296 review gate reading the run's commit range, 2026-08-27. HEAD is fine; the HISTORY is not.

WHERE. fe9abda 'fix(ios): pill() takes LocalizedStringKey so shift-row pills localize (TASK-298)', NFCTimeSheets/NFCTimeSheets/ContentView.swift.

MEASURED STATE. That commit's diff contains, besides the pill() change it is about:
    + await refreshFlags()     // decision-57: same pass as the roster, never blocking
Its declaration lands three commits later, in 33b0b4d (TASK-294):
    git grep 'func refreshFlags' fe9abda -- NFCTimeSheets/   ->  NOT DEFINED at fe9abda
    git grep 'func refreshFlags' 33b0b4d -- NFCTimeSheets/   ->  Sync.swift:61
So fe9abda and cffe9ca are commits at which the iOS target cannot compile: a call to an undeclared function.

HOW. TASK-298 (iOS pill) and TASK-294 (iOS flags) both edit ContentView.swift and ran against ONE working tree; the pill commit swept up a line the flags agent had already written. This is precisely the failure ops/WORKTREES.md (TASK-210) exists to prevent, and the reason AGENTS.md says never git add -A.

WHAT BREAKS. Nothing a user sees - HEAD has both halves. What breaks is bisect and revert: git bisect over this range lands on a commit that fails to build and reports the wrong culprit, and reverting fe9abda alone leaves refreshFlags() called from nowhere or defined and unused depending on direction. It also makes the commit message false about its own contents, which is what a reviewer reads first.

FIX. Do not rewrite published history - these six commits are unpushed today but the cost of getting a rewrite wrong is higher than the defect. Record it instead: a note on TASK-298 and TASK-294 that the boundary is wrong, so nobody bisects this range without knowing. If the range IS still unpushed when this is picked up, the honest option is an interactive rebase splitting the stray line out of fe9abda into 33b0b4d - only with the working tree clean and no other run in flight.

THE PROCESS FIX IS THE POINT. Two agents editing one file in one tree produced this. Next multi-task run touching a shared file uses one git worktree per run (ops/WORKTREES.md), or commits with an explicit pathspec (git commit -o <path>), never git add -A.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the wrong commit boundary is recorded on TASK-298 and TASK-294 so a future bisect is not misled
- [ ] #2 if the range is still unpushed: the stray refreshFlags() line moved into 33b0b4d by rebase, with every commit in the range building
- [ ] #3 the run that lands this states which isolation it used (worktree or pathspec commit)
<!-- AC:END -->
