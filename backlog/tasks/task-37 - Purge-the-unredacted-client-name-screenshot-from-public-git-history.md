---
id: TASK-37
title: Purge the unredacted client-name screenshot from public git history
status: To Do
assignee: []
created_date: '2026-08-04 17:44'
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
TRIAGE 2026-08-04 (agent 2) — OPEN. Privacy-affecting, PUBLIC repo.

WHAT LEAKED: docs/media/app-shift.png carried a real third-party client name on every row of the
shift history. It was removed from the tree at 33e66b2 and replaced with a masked version.

WHAT IS STILL TRUE: 'git show 33e66b2:docs/media/app-shift.png' works for anyone who clones this
repo. The redaction commit changed the tree, not the history.

RELATED AND ALREADY FIXED (do not re-do): the demo library at
~/Desktop/demos/hoiv/nfc-timesheets/clips/stills/app-shift.png held a byte-identical copy
(sha256 4920c2ad…) - it was the only unredacted copy OUTSIDE git history. It has been deleted and
replaced with the masked version, and MANIFEST.md records the exposure. That does NOT touch the
git blob, which is what this task is about.

WHAT BREAKS IF NEVER DONE: a real client of the cleaning company is named, publicly and
permanently, in a repo anyone can clone. It is not visible on the GitHub UI's file list, so the
exposure is quiet rather than absent - which is worse, because nobody is reminded of it.

ponytail: the cheap option is to accept and record it. Ceiling: it stays fetchable forever.
Upgrade path: git-filter-repo --path docs/media/app-shift.png --invert-paths, force push, then
ask GitHub Support to run GC.
<!-- SECTION:NOTES:END -->
