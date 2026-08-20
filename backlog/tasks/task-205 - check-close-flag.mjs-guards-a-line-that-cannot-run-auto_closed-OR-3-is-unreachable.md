---
id: TASK-205
title: >-
  check-close-flag.mjs guards a line that cannot run: auto_closed OR $3 is
  unreachable
status: To Do
assignee: []
created_date: '2026-08-20 02:09'
labels:
  - checks
  - decision-10
  - measured
dependencies: []
priority: medium
ordinal: 123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
server/check-close-flag.mjs reads routes/app.js as TEXT, greps for

  auto_closed = auto_closed OR $3

and then evaluates a four-row JS truth table of the || operator. It never opens a database
connection. 7 PASS.

The line it guards is unreachable. EXHAUSTIVE, not argued -- there are exactly two writers
of shifts.auto_closed in the whole tree:

  ops/sql/autoclose.sql   SET end_time = start+8h, auto_closed = true  WHERE end_time IS NULL
  routes/app.js:292       SET end_time = $2, auto_closed = auto_closed OR $3
                          WHERE ... AND end_time IS NULL

001 defaults it false. routes/admin.js writes it never ('auto_closed is NOT patchable',
admin.js:1291) and its INSERT names four columns, none of them this one.

Both writers set end_time in the SAME statement that raises the flag, so the state
'end_time IS NULL AND auto_closed' does not exist. The UPDATE only matches rows with
end_time IS NULL, therefore its left operand is ALWAYS false, therefore

  auto_closed = auto_closed OR $3   ===   auto_closed = $3

MEASURED: mutate the OR away and check-api.js PASSES, check-field-wire.mjs PASSES; only
check-close-flag.mjs -- the grep -- goes red, on the string, not on a behaviour.

WHAT ACTUALLY PROTECTS THE FLAG is the idempotent-close early return at app.js:270
('if (current.end_time !== null) return 200 with the row as it stands'). A replayed
tap-out never reaches the UPDATE at all. That is now asserted against the database by
server/db/check-field-wire.mjs, and its mutant needs THREE simultaneous edits to go red
precisely because the three guards stack.

The defence-in-depth is cheap and should probably stay. What must not stay is a check that
reports 7 PASS for a property no code path can violate: that is one of the vacuous checks
AGENTS.md warns about, and it is the reason the real guard went untested.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 check-close-flag.mjs either exercises the property against a database, or says in its own header that it is a source-text guard for defence-in-depth and asserts nothing observable
- [ ] #2 If the OR is kept, a comment at app.js:292 records that it is unreachable today and names the state that would make it reachable
- [ ] #3 The negative case is shown: whatever the check becomes, a mutant makes it red for the RIGHT reason
<!-- AC:END -->
