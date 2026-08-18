---
id: TASK-184
title: >-
  Clip the contract accrual to today, or decide not to: /pl/ and /analytics/
  still book a whole running period
status: To Do
assignee: []
created_date: '2026-08-18 19:33'
labels:
  - backend
dependencies: []
priority: high
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FILED BY TASK-175, which deliberately did not do this. TASK-175 shipped the sentence; this
is the arithmetic behind it, and it changes numbers that have already been reported, so it
needs a decision record before a line of it is written.

TODAY. `contractSlice` (server/lib/reporting.js) accrues the monthly contract fee -- and the
monthly target_minutes -- for EVERY contract-valid Vienna day in the requested range, with
no clipping to today. Labour and materials only exist for days that have happened. So a
period whose end is in the future compares a complete revenue side against a partial cost
side. Measured on nfc_demo on 18 August 2026:

  Dieses Jahr    Marge 71,33 %   (135 of 365 days have not happened)
  Dieses Quartal Marge 53,75 %   ( 43 of  92)
  Dieser Monat   Marge 50,47 %   ( 13 of  31)
  Voriger Monat  Marge 10,70 %   (the closed month, and the only honest one)

THE PROPOSED RULE, argued in full in TASK-175's implementation notes: a period accrues
REVENUE EARNED TO DATE -- the fee for the days of the period that have actually happened,
nothing for the days that have not. Rejected alternatives, in TASK-175: booking the full
period (today), projecting the cost side to match it (a forecast, which this codebase
refuses elsewhere), and refusing to compute a margin at all while a period is running
(deletes a true number to avoid a caveat).

WHAT MAKES THIS A DECISION AND NOT A COMMIT:
1. It changes /pl/ and /analytics/ figures for every period that includes today. A director
   who wrote down last week's "Dieses Jahr" margin will not be able to reproduce it.
2. It changes what a CLOSED period means only by NOT changing it -- clipping is a no-op for
   a period entirely in the past, and that invariant is the reason the change is safe. It
   has to be stated and tested, not assumed.
3. It has to say what "today" is on a server whose clock is UTC and whose reports are
   Vienna. The clipping boundary is a Vienna calendar day, the same rule VIENNA_DAYS
   already applies, and it is the same DST trap: 27 October is a 25-hour day and still one
   day.
4. It touches the target_minutes side too, or /analytics/ and /pl/ will clip differently
   and disagree about the same period.

NOT A PREREQUISITE FOR ANYTHING. The disclosure shipped in TASK-175 stands on its own: with
this task done, `isPartElapsed` is still true for a running period and the sentence should
change rather than disappear -- "the elapsed part only" is itself something the reader has
to be told, especially on the first day of a month.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision record exists that states what a part-elapsed period accrues, names the rejected alternatives, and says explicitly what happens on the first day of a period, on a period entirely in the future, and on one entirely in the past
- [ ] #2 If the decision is to clip: contractSlice clips revenue_cents AND target_minutes to Vienna days that have elapsed, and a period entirely in the past produces byte-identical output to today (a regression test proves it over a closed month)
- [ ] #3 If the decision is to clip: a period entirely in the future yields revenue_cents 0 with margin_unknown_reason zero_revenue, never a 100% margin
- [ ] #4 /pl/ and /analytics/ clip identically, so the two screens cannot disagree about the same period
- [ ] #5 The disclosure shipped by TASK-175 is re-worded rather than deleted: a reader still has to be told that only the elapsed part is counted
- [ ] #6 demo/check-money.mjs is extended, and its new assertions are shown red before they are made green
<!-- AC:END -->
