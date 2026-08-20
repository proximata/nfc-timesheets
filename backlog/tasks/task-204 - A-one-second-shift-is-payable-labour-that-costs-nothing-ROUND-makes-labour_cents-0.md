---
id: TASK-204
title: >-
  A one-second shift is payable labour that costs nothing: ROUND() makes
  labour_cents 0
status: To Do
assignee: []
created_date: '2026-08-20 02:08'
labels:
  - payroll
  - decision-41
  - measured
dependencies: []
priority: medium
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, twice, on a scratch restore of the 2026-08-20 production dump with 006 applied.

lib/reporting.js labourByLocation():

  SUM(secs) per (location, worker) -> SUM(ROUND(secs * hourly_rate_cents / 3600.0))

A worker whose WHOLE period at a building totals 1 second, at the normal 1500 c/h rate,
gives ROUND(1 * 1500 / 3600.0) = ROUND(0.4167) = 0.

  labour_seconds = 1   labour_cents = 0

Reachable through the field APK's exact wire shape, not just by SQL: POST /shifts/open then
POST /shifts/close one second later -> 201 / 200 -> the query above returns exactly that.
The double-tap that produces it (tap in, realise it is the wrong door, tap out) is a normal
thing for a cleaner to do.

WHY IT MATTERS BEYOND ONE CENT. decision-41's argument for DELETING the named
'Kein Stundensatz' exclusion is that a building can no longer report hours that cost
nothing. That is now true for its ORIGINAL cause (a rate-less worker is unrepresentable --
verified: omitted 23502, NULL 23502, 0 and negative 23514, edit-to-zero 23514, the DEFAULT
is gone and the CHECK is convalidated) and FALSE for a second, unrelated cause: integer
rounding. Two different defects wearing one sentence.

server/check-api.js already asserts the invariant:

  for (const b of payload.buildings) if (b.labour_seconds > 0) assert.ok(b.labour_cents > 0)

It passes only because no fixture ever totals one second. Seed one and it goes red -- which
is the point: the assertion is right and the code does not satisfy it.

NOT a reason to bring the deleted copy back. 'Kein Stundensatz' named a missing WAGE; this
names a rounding floor and needs its own answer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A seeded 1-second total at a building makes server/check-api.js RED before the fix (show the failure), and green after
- [ ] #2 labour_cents is >= 1 for any (location, worker) whose payable seconds are >= 1, at every rate the collective agreement admits
- [ ] #3 Money stays INTEGER cents and no float multiply is introduced (AGENTS.md)
- [ ] #4 Whatever rounding rule is chosen is stated in a comment with the direction it favours and WHO it favours
<!-- AC:END -->
