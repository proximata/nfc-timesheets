---
id: TASK-313
title: 'decision-50 body says ACCEPTED but its frontmatter still says status: proposed'
status: To Do
assignee: []
created_date: '2026-08-29 11:22'
labels:
  - docs
  - backlog
dependencies: []
ordinal: 231000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the review gate.

Commit 4d62df6 is titled 'accept decision-50' and rewrote the record's opening paragraph to
'ACCEPTED 2026-08-29 by the owner', but the YAML frontmatter on line 7 still reads:

  status: proposed

So the CLI and anything else reading metadata still reports decision-50 as proposed while
the prose says accepted. decision-59 itself is correctly 'status: accepted'.

The record was edited as a markdown file rather than through the backlog CLI, which is what
AGENTS.md forbids for exactly this reason - metadata and body drift apart.

FIX: set the status through the CLI so both agree. While in there, check decision-40, which
AGENTS.md already flags as 'status: proposed but already the live split' - same class of
drift, different record.

Not a code defect. Filed so the board stops disagreeing with itself about which rules bind.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-50 frontmatter status matches its body
- [ ] #2 decision-40's proposed/live mismatch is fixed or explicitly recorded as intentional
<!-- AC:END -->
