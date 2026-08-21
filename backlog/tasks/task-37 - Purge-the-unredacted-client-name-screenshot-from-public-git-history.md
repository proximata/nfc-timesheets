---
id: TASK-37
title: Purge the unredacted client-name screenshot from public git history
status: To Do
assignee: []
created_date: '2026-08-04 17:44'
updated_date: '2026-08-21 13:00'
labels:
  - privacy
  - security
  - repo
dependencies: []
priority: high
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A demo still that shows a REAL third-party client name on every row is still fetchable from the history of this PUBLIC repo (github.com/qwadratic/nfc-timesheets).

Commit 33e66b2 DELETED docs/media/app-shift.png from the working tree, but deleting a file does not remove the blob. Anyone who clones the repo can still run:

    git show 33e66b2:docs/media/app-shift.png

and get the unredacted image back.

BLOCKED ON THE OWNER: fixing this needs a history rewrite (git-filter-repo or BFG) plus a FORCE PUSH to a public repo, which rewrites every commit SHA after the touched one. That invalidates existing clones and any SHA referenced elsewhere. An agent must not force-push a public repo unilaterally - the owner decides.

Filed by triage agent 2, 2026-08-04. Found during the demo verify phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Decide: rewrite history, or accept the exposure and record the acceptance
- [ ] #2 If rewriting: the blob is unreachable via git show <sha>:docs/media/app-shift.png on a fresh clone
- [ ] #3 GitHub asked to expire cached views of the old blob (they survive a rewrite until GC)
- [ ] #4 Any other historical media re-checked for the same leak, not just this one file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RELATED AND WIDER, filed 2026-08-21 as TASK-239: this task is about a blob DELETED from the tree in 33e66b2. TASK-239 found the same class still TRACKED IN HEAD — docs/media/prove-live/02-building-created.png named a real person, a street address and a contract sum. Removed from HEAD in 987368b; the blob remains fetchable from 2cc19b2. DO BOTH BLOBS IN ONE REWRITE — a second force push to a public repo is a second round of invalidated clones for no extra benefit.
<!-- SECTION:NOTES:END -->
