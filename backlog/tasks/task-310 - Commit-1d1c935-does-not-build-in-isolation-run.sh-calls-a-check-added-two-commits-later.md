---
id: TASK-310
title: >-
  Commit 1d1c935 does not build in isolation: run.sh calls a check added two
  commits later
status: To Do
assignee: []
created_date: '2026-08-29 11:20'
labels:
  - ops
  - git
  - workflow
dependencies: []
ordinal: 228000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the review gate. HEAD is fine; the INTERMEDIATE commit is not.

EVIDENCE:
  git show 1d1c935:NFCTimeSheets/checks/run.sh | grep sms-gate
    71: if swift checks/sms-gate-check.swift; then :; else failed=1; fi
  git cat-file -e 1d1c935:NFCTimeSheets/checks/sms-gate-check.swift
    -> path exists on disk, but not in 1d1c935

checks/sms-gate-check.swift only arrives in b1385b5, two commits later. So checking out
1d1c935 or 75fd766 or 79056ba and running NFCTimeSheets/checks/run.sh fails on a missing
file. git bisect over this range, or any per-commit CI, hits a false red.

CAUSE: exactly the ops/WORKTREES.md hazard. Four agents shared one working tree and one git
index; the SMS agent's edits to NFCTimeSheets/checks/run.sh and android/checks/core-check.kt
were uncommitted when the iOS write-flow and Android gate agents committed, and were swept in
by a broad add. The SMS agent self-reported this. Attribution is also wrong: the Android half
of the decision-59 work sits in a commit whose message is about tag reading.

FILES TOUCHED BY MORE THAN ONE COMMIT IN THE RANGE (checked, no content damage found):
  android/checks/run.sh   (75fd766 + 79056ba)
  android/.gitignore      (75fd766 + 79056ba)
Both merged cleanly; android/checks/run.sh at 75fd766 does NOT reference raw-tag-io, so the
Android side has no equivalent breakage. Final HEAD state is coherent - all check suites pass.

FIX OPTIONS (pick one, this is not urgent but it is not nothing):
a) leave it, and record here that the range is not bisectable - cheapest, honest;
b) rebase the five commits so run.sh's sms-gate line lands with the file it calls. Only safe
   BEFORE the push; after the push this is a history rewrite and not worth it.

PREVENTION is the real deliverable: ops/WORKTREES.md already prescribes one git worktree per
run. It was not followed here. Make the workflow runner enforce it, or make each agent commit
with 'git commit -o <path>' and never a broad add.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the range is either made bisectable before push, or the non-bisectable range is recorded so nobody debugs a false red
- [ ] #2 the next multi-agent run uses one worktree per track, or per-path commits
<!-- AC:END -->
