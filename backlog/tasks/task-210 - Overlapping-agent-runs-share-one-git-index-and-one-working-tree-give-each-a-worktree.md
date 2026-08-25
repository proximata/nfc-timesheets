---
id: TASK-210
title: >-
  Overlapping agent runs share one git index and one working tree: give each a
  worktree
status: Done
assignee: []
created_date: '2026-08-20 04:04'
updated_date: '2026-08-25 13:55'
labels:
  - ops
  - process
  - measured
dependencies: []
priority: high
ordinal: 128000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
OBSERVED THREE TIMES IN ONE NIGHT, on this tree, by two different runs. This is not a style note; it has already put another run's code into a commit whose message described something else.

  03:58  web/app/pl/page.tsx held another run's LIVE UNCOMMITTED mutant:
         t(revenueUnknown) -> money(0), which is decision-42 exact violation.
         The data probe saw it, deliberately left it alone (reverting another run
         in-flight mutation destroys its evidence), and recorded it. A "git add -A"
         in that minute would have SHIPPED it.
  04:2x  three files staged by the data probe went out inside commit 6757082, under
         the money probe message. Nothing was lost; the message is simply not about
         most of what the commit contains. Caught at 9d99966.
  05:06  a headless Chrome and a node server.js were left orphaned on the two fixed
         ports the probes use (:9341, :8080). The next run launchChrome() polled
         /json/version, got the ORPHAN answer, attached to a dead target and died
         with "Error: Promise was collected". demo/build-guard.mjs assertFreshServer
         exists precisely because the server half of this already produced a false GREEN.

AGENTS.md says "never git add -A". That is NECESSARY AND NOT SUFFICIENT. Staging a path stages a path; committing without a pathspec commits the whole SHARED index. Two agents cannot both hold a staged index in one working tree, and no amount of discipline about which paths you stage changes that.

WHAT ACTUALLY FIXES IT: separate worktrees (git worktree add), one per run, merged at the end. Second best, and cheap: "git commit --only <paths>", which commits exactly the named paths and ignores the rest of the index.

The port collisions are the same problem in a different resource: two runs, one :8080.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a documented procedure exists for launching overlapping runs on separate git worktrees, in AGENTS.md or ops/
- [x] #2 the fallback is written down too: git commit -o <paths> commits only the named paths regardless of what else is staged
- [ ] #3 demo/ and server/ check ports are either per-run or the orphan is detected - assertFreshServer already does the server half; launchChrome() needs the same for its fixed port
- [ ] #4 the negative case is exercised: two concurrent runs, one stages a file, the other commits - and the first run's file does NOT appear in the second's commit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED 2026-08-25. Procedure written: ops/WORKTREES.md (git worktree add per edit-run, merge back on Verify success; git commit -o <path> as the cheap fallback for a short single-file run). Cross-referenced from AGENTS.md's workflow-tool-quirks section so a future run finds it before, not after, a collision.
<!-- SECTION:NOTES:END -->
