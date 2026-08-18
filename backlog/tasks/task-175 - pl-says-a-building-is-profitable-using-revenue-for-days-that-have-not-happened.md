---
id: TASK-175
title: >-
  /pl/ says a building is profitable using revenue for days that have not
  happened
status: To Do
assignee: []
created_date: '2026-08-18 18:52'
labels:
  - ux
  - bug
  - money
dependencies: []
priority: high
ordinal: 93000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, not suspected. `periodRange` (web/lib/period.ts) ends 'thisMonth', 'thisQuarter' and 'thisYear' at a FUTURE boundary, and `contractSlice` (server/lib/reporting.js) accrues the monthly contract fee for EVERY contract-valid day in the requested range with no clipping to today. Labour only exists for elapsed days. So any period whose end is in the future books unearned revenue against real labour and reports a margin that is too high, always in the flattering direction.

Evidence (docs/media/states/, regenerate with demo/shoot-states.mjs):
- state-onerow-pl-1680-dark.png: one building, one 3:15 shift, period 'Dieses Jahr' -> Marge 99,25 %, Ergebnis 8.340,65 EUR. This is week one of a real client.
- state-baseline-pl-1680-dark.png: 25 % baseline set, period 'Dieses Jahr' -> Marge 76,99 % overall, per-building 78,21 % and 74,22 %, and 'Auf oder \u00fcber der Zielmarge' for every building.

The screen already refuses to guess elsewhere (revenueUnknown never 0,00 EUR; 'nicht beurteilbar' is not a pass; revenuePartial when the CONTRACT covers less than the period). There is no state for the reverse case, a PERIOD that extends past today, and nothing in the methodology callout mentions it.

CHEAPEST HONEST FIX FIRST, client side only, no arithmetic changed: when range.to is later than now, add a line to the methodology callout naming how many days of the period have not happened yet and stating that revenue is booked for all of them while labour is only booked up to today, so the margin is too high. New de/en key pair, exact parity, plural for 'Tage'.

DO NOT clip the revenue accrual in server/lib/reporting.js as part of this task: that changes numbers already reported and needs its own decision record (it would also silently change what a closed past period means). File that separately if the owner wants it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With period=thisYear or thisMonth or thisQuarter and today inside the period, /pl/ renders a methodology line naming the number of days of the period that lie in the future
- [ ] #2 The line states that revenue is counted for the whole period and labour only up to today, and that the margin shown is therefore too high
- [ ] #3 With period=lastMonth (a closed period) the line is absent
- [ ] #4 No number on /pl/ changes: server/lib/reporting.js is untouched and demo/check-reports.mjs still passes
- [ ] #5 de.json and en.json gain the same keys, Austrian business German, plural branches for the day count (demo/audit-icu.mjs passes)
- [ ] #6 Journey D8 ('is this building worth the contract', JOURNEYS.md 2.D8): a director picking 'Dieses Jahr' in August cannot read an inflated margin without a sentence on screen telling them it is inflated
- [ ] #7 Journey D12 (reprice a building): the same line is on screen when the repricing decision is made
<!-- AC:END -->
