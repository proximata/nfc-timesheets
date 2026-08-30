---
id: TASK-329
title: >-
  decision-63 redid enrolment.js's arithmetic block but left six OTHER sites
  still quoting the retired 2^40 / 5-day / 30-per-minute numbers
status: To Do
assignee: []
created_date: '2026-08-29 23:53'
updated_date: '2026-08-29 23:54'
labels:
  - server
  - docs
  - decision-63
dependencies: []
priority: medium
ordinal: 247000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
lib/enrolment.js's header ends with a standing instruction: 'If the alphabet, the length, the TTL or either limit changes, redo this block. It is the justification for the whole mechanism, not decoration.' Commit 003d2e4 redid THAT block correctly - the review gate re-derived every figure independently and all of them check out (10^5 keyspace, 5*15=75 guesses per lifetime, 7.5e-4 ~ 1 in 1333, 3.75e-2 ~ 1 in 27, 16.6 bits). What it did not do is follow the same instruction into the other files that state the same arithmetic.

STALE AT HEAD, all in editable source, all now wrong by orders of magnitude:
  server/routes/admin.js:751   'same 5-day CODE_TTL_MS'            -> CODE_TTL_MS is 15 minutes
  server/routes/admin.js:754   'A collision is ~1 in 2^40 per issue' -> keyspace is 10^5, so a
                                collision against ONE live code is ~1e-5 per issue and ~5e-4 at
                                the file's own pessimistic 50-live-codes ceiling. The 3-attempt
                                retry loop plus the UNIQUE index still make this safe, but the
                                number that JUSTIFIES the loop is off by seven orders of magnitude.
  server/routes/admin.js:1305  '~1-in-2^40 event' - same, operator mint
  server/routes/auth.js:358    'see decision-45s server-side plan for why the existing 30/min
                                headroom still holds' -> the ceiling is 5/min since decision-63 section 5
  server/routes/auth.js:476    'against a shared 40-bit search space' -> ~17-bit
                                (lib/auth.js:392 was updated to ~17-bit; this twin was not)
  server/check-api.js:1346     'a property that makes 40 bits safe'

NOT IN SCOPE - deliberately leave alone:
  db/migrations/004 and 007 also say 40 bits. Those files are APPLIED ON THE LIVE BOX and
  db/README.md forbids editing them; they are a historical record of what was true when they
  ran. Do not touch them.
  server/lib/sms.js was already updated correctly by 003d2e4 (it says 'now 15 minutes,
  decision-63, down from five days') - no work there.

Also stale, and it was stale BEFORE decision-63 (it claimed one hour while the TTL was five
days), so it is now wrong for the second time:
  backlog/docs/ENROLMENT-CODES.md:117  'The code expires after one hour'
  backlog/docs/ENROLMENT-CODES.md:228  'You cannot set how long a code lasts. It is one hour for everyone.'

This is comments and prose only - no behaviour changes. It matters because in this codebase the
arithmetic comment IS the control: the next person reading admin.js:754 concludes a collision is
impossible and sizes the retry loop accordingly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 all six source sites state the decision-63 numbers (15 min TTL, 10^5 keyspace, 5/min global ceiling, ~17-bit)
- [ ] #2 ENROLMENT-CODES.md says 15 minutes in both places and names decision-63
- [ ] #3 migrations 004 and 007 are UNCHANGED - git diff shows no migration touched
- [ ] #4 grep -rn '2\^40|40-bit|5-day CODE_TTL|30/min' over server/ excluding db/migrations returns nothing
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: review-gate
created: 2026-08-29 23:54
---
Review gate, second pass: a SEVENTH stale site, and this one is the worst of the set because it describes deleted BEHAVIOUR rather than a retired number.

  server/routes/auth.js:202
    const code = normaliseCode(body.code); // folds case, strips separators, aliases O/I/L

decision-63 section 1 deleted the aliasing step outright. A reader of codeAuth is told the
normaliser still folds O->0 and I/L->1, which is exactly the false belief that left
check-api.js:1500 red (see TASK-328). Add it to the same sweep; the honest comment is
'strips everything that is not a digit'.
---
<!-- COMMENTS:END -->
