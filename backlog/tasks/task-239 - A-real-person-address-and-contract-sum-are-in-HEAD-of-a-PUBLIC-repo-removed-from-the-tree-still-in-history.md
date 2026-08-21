---
id: TASK-239
title: >-
  A real person, address and contract sum are in HEAD of a PUBLIC repo --
  removed from the tree, still in history
status: In Progress
assignee: []
created_date: '2026-08-21 13:00'
updated_date: '2026-08-21 13:00'
labels:
  - privacy
  - security
  - repo
  - verdict
dependencies: []
priority: high
ordinal: 157000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND by the verdict pass 2026-08-21, by opening a committed screenshot rather than by running anything.

docs/media/prove-live/02-building-created.png and its .txt sibling carried, legibly and in HEAD:
  - the client contact's FULL NAME (a real natural person)
  - the building's STREET ADDRESS
  - the monthly contract value, 5.000,00 EUR

github.com/proximata/nfc-timesheets is PUBLIC. The files were added by 2cc19b2 and have been tracked ever since.

The README in that same directory ENDED WITH: "Nothing here carries a real customer name, address or rate." That sentence was written by the run that produced the files, was believed by every run after it, and nothing could ever have contradicted it. The leak is one file; the missing check was the class.

DONE IN 987368b, and it is the half an agent may do:
  - the four offending files removed from HEAD (02-building-created.{png,txt,console.txt} and 05-map-blocked.png, which had no transcript to vouch for it)
  - ops/check-media-pii.sh: reads names/addresses/contacts/contract sums from the LIVE database at run time, greps every committed transcript under docs/media, refuses a committed prove-live screenshot with no .txt sibling, and requires the README to point at a check rather than assert a property. RED via --mutate, which restores the file from 2cc19b2.
  - the README now records what was false and why.

WHAT IS LEFT, AND IT IS THE OWNER'S. Deleting a file does not remove the blob:

    git show 2cc19b2:docs/media/prove-live/02-building-created.png

still returns the unredacted image to anybody who clones. That needs git-filter-repo or BFG plus a FORCE PUSH to a public repo, which rewrites every commit SHA after the touched one and invalidates existing clones. TASK-37 is the same remedy for a different blob and is blocked on the same decision -- do BOTH in one rewrite, not two.

CONSIDER ALSO, in the same pass: whether this repository should be public at all. It carries the operator's brand, hosts, the tag host that is screwed to walls, and the shape of a paying client's contract.

ACCEPTANCE:
- ops/check-media-pii.sh green on the tree, red under --mutate  [done]
- history rewritten so the blob above 404s, and the force push made by the owner  [NOT done]
- TASK-37's blob covered by the same rewrite  [NOT done]
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ops/check-media-pii.sh is green on the tree and red under --mutate
- [x] #2 The four files naming a real person are out of HEAD
- [ ] #3 The blobs are gone from history and TASK-37's blob went with them in the same rewrite
- [ ] #4 A decision is recorded on whether this repository stays public
<!-- AC:END -->
