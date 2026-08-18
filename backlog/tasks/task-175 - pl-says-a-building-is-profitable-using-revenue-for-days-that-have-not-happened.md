---
id: TASK-175
title: >-
  /pl/ says a building is profitable using revenue for days that have not
  happened
status: Done
assignee: []
created_date: '2026-08-18 18:52'
updated_date: '2026-08-18 19:34'
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
- [x] #1 With period=thisYear or thisMonth or thisQuarter and today inside the period, /pl/ renders a methodology line naming the number of days of the period that lie in the future
- [x] #2 The line states that revenue is counted for the whole period and labour only up to today, and that the margin shown is therefore too high
- [x] #3 With period=lastMonth (a closed period) the line is absent
- [x] #4 No number on /pl/ changes: server/lib/reporting.js is untouched and demo/check-reports.mjs still passes
- [x] #5 de.json and en.json gain the same keys, Austrian business German, plural branches for the day count (demo/audit-icu.mjs passes)
- [x] #6 Journey D8 ('is this building worth the contract', JOURNEYS.md 2.D8): a director picking 'Dieses Jahr' in August cannot read an inflated margin without a sentence on screen telling them it is inflated
- [x] #7 Journey D12 (reprice a building): the same line is on screen when the repricing decision is made
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
WHAT A PART-ELAPSED PERIOD SHOULD ACCRUE, and what was rejected.

It should accrue REVENUE EARNED TO DATE: the contract fee for the days of the period that
have actually happened, and nothing for the days that have not. A cleaning contract is a
monthly retainer for work performed; on 18 August the client owes for eighteen days of
August and owes nothing yet for the 19th. Booking the whole month against three weeks of
labour is not conservative and not neutral - it is wrong in one direction only, the
flattering one, and it is the input to "is this building worth keeping".

REJECTED, and why:
- BOOK THE FULL PERIOD (the current behaviour). Defensible only if the question were "what
  will this period be worth", and the screen does not ask that: it puts the number beside
  labour that is measured to date. Two sides, two different clocks.
- CLIP THE LABOUR TOO, i.e. compare full-period revenue against a projected cost. That is a
  forecast, and this codebase already refuses to forecast (trend_reason
  "insufficient_data" rather than a flat line). A projection built on three weeks of a
  building's first month would be worse than the accrual it replaced.
- REFUSE TO COMPUTE A MARGIN AT ALL while the period is running, the way revenueUnknown
  refuses a missing contract. Rejected: the elapsed part IS knowable and IS useful -
  "August so far" is a real question - and a blanket refusal would delete a true number to
  avoid explaining a caveat. NOTHING TRUE MAY BE DELETED TO LIGHTEN A SCREEN.

THE THREE EDGE CASES, explicitly:
- FIRST DAY OF A PERIOD. Elapsed revenue is one part-day. Under clipping the margin is
  computed on a day of revenue against a day of labour - volatile but honest, and it must
  be read with the day count beside it, which is what this task shipped. Under the current
  accrual it is the worst case: a whole month of revenue against a few hours of work.
- A PERIOD ENTIRELY IN THE FUTURE. Elapsed revenue is 0 and elapsed labour is 0, so the
  margin is NOT COMPUTABLE and must say so - margin_unknown_reason "zero_revenue" already
  exists for exactly that shape. It must never come out as 100 % (revenue 0 minus cost 0).
  No member of PERIODS can be one, so this is a statement about the arithmetic and not
  about a reachable screen.
- A PERIOD ENTIRELY IN THE PAST. Clipping is a no-op: every day of it has happened, so
  revenue earned to date IS the full accrual. Closed periods keep the numbers they have
  always reported, which is the property that makes the change safe to make later.

WHAT WAS SHIPPED HERE is the cheapest honest fix and nothing more: no arithmetic changed,
server/lib/reporting.js untouched, all four margins byte-identical before and after
(71,33 % / 53,75 % / 50,47 % / 10,70 % on nfc_demo, 18 August). The clipping itself is
filed separately because it changes numbers already reported and needs its own decision
record.

CROSS-CHECK of every other period and every other screen that divides a contract by a
period:
- lastMonth: to <= now, closed, unaffected. Verified on screen - no sentence, and the
  margin cell's sub is the baseline alone.
- last30Days: ends at TOMORROW's Vienna midnight, so it is "still running" by less than one
  whole day - the whole of today is priced and only the hours worked so far exist. True and
  small; it gets the =0 plural branch ("Zeitraum laeuft noch"), never a printed "0 Tage".
- thisMonth / thisQuarter / thisYear: affected, all three carry the line. Verified.
- all: /pl/ and /analytics/ both refuse it (PAYROLL_PERIODS, and /admin/pl requires both
  bounds), so it cannot reach either screen. isPartElapsed returns false for it anyway.
- /analytics/ IS affected and was not in the original report: the same contractSlice
  accrues target_minutes, so a running period compares a full period's target against
  partial work and reports every building as UNDER its agreed time. Same defect, opposite
  direction - there it flatters, here it accuses. Same sentence, same commit.
- The dashboard / fetches neither /admin/pl nor /admin/analytics. BuildingFacts prints
  monthly_contract_cents as the monthly figure it is, undivided, and links to /pl/ with an
  explicit period. Not affected.
- The client portal carries NO money and no target at all (server/routes/portal.js's field
  list excludes every contract figure by construction). Not affected.
- /contracts/ and /locations/ print the monthly figure undivided. Not affected.

VERIFICATION. demo/check-money.mjs, against a real build served from the API on loopback,
reading the rendered screen. 19 failures before the fix and 0 after; six negative-case
assertions re-run against a build with the conditions forced on, all six red. Two mutants
of futureDays (read the clock in UTC; subtract instants instead of calendar days) go red on
web/scripts/check.mjs. demo/audit-icu.mjs, demo/audit-german.mjs, demo/audit-widths.mjs and
demo/audit-band.mjs all pass; nfc_demo restored and fingerprinted, row counts and hourly
rates both.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/pl/ and /analytics/ now state how much of a running period has not happened, and which way that bends the number. No arithmetic changed: server/lib/reporting.js is untouched and all four margins are byte-identical before and after (71,33 / 53,75 / 50,47 / 10,70 % on nfc_demo, 18 August). lib/period.ts gained isPartElapsed + futureDays (Vienna calendar days, DST-safe by construction); /pl/ carries the warning on the margin cell AND in the method block, /analytics/ on its 'Unter der vereinbarten Zeit' cell and in its standing notes; a closed period carries neither. de/en key parity with =0/one/other branches. Verified by demo/check-money.mjs reading the rendered screen (19 red before, 0 after; six negative-case assertions re-run red against a forced-on build) and by two red mutants of futureDays in web/scripts/check.mjs. Clipping the accrual is TASK-184.
<!-- SECTION:FINAL_SUMMARY:END -->
