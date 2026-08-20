---
id: TASK-194
title: The P&L stops accruing revenue and refuses a margin over a ragged period
status: Done
assignee: []
created_date: '2026-08-19 13:57'
updated_date: '2026-08-20 04:01'
labels:
  - server
  - revenue
  - pl
  - reporting
dependencies:
  - TASK-193
documentation:
  - backlog/decisions/decision-42
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-42, the reporting half. ZONES-MODEL.md $2.5.

TODAY lib/reporting.js contractSlice() pro-rates a monthly fee by DAY against the length of
that day's own month. It is careful arithmetic about a number nobody received.

CHANGE:
  contractSlice()  KEEPS producing target_minutes for /analytics/ and for the
                   'vereinbart vs erhalten' comparison. Its revenue_cents output is RETIRED
                   from the P&L.
  revenueSlice()   NEW. The in-force location_revenue entries for the WHOLE Vienna months
                   fully contained in [from, to).

  period is exactly N whole Vienna months  -> revenue = SUM of those entries
  period is ragged                         -> whole contained months ONLY; the partial months
                                              are NAMED as excluded, never sliced
                                              margin_bp = NULL, 'period_not_month_aligned'

A typed payment cannot be pro-rated: 17/30ths of 'the client paid 1.250,00 in September'
invents a payment schedule nobody agreed to. Cost keeps its exact half-open day boundaries, so
comparing full-month revenue against partial-month labour would be a margin from two different
periods. Refuse it rather than approximate it.

WIRE:
  revenue_cents            from location_revenue, or null
  revenue_unknown_reason   'not_entered'   (replaces 'no_contract' as the common case)
  revenue_entered_at / revenue_entered_by_name / revenue_changed_at / revenue_previous_cents
  contract_cents           the month's AGREED figure, for the comparison
  margin_unknown_reason    gains 'revenue_not_entered' and 'period_not_month_aligned'
  months_missing_revenue   a COUNT, per building and for the period

FREE WIN, and it must be stated in the code comment: isPartElapsed exists because contract
revenue accrued for future days while labour only exists for days that happened -- 'Dieses
Jahr' in August booked five future months and reported 71,33% against the 10,70% the last
closed month made. An unfinished month now simply has no entry, so it reports UNKNOWN instead
of INFLATED. The isPartElapsed warning survives as a narrower statement about labour and
materials; do not delete it, narrow it.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#2,#3 -> D8 (is this building worth the contract?): the margin is only allowed to exist where a real payment was entered.
AC#4        -> D8: „Dieses Jahr" picked mid-year is the exact click that books unfinished months today.
AC#5        -> D7 (month-end payroll ★) and S1 (8 h auto-close): the Vienna DST boundaries are the same boundaries payroll periods are cut on.
AC#6,#7     -> D7: integer cents, and decision-10's exclusions still asserted after the rewrite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 profitAndLoss reads location_revenue, not contractSlice, for money
- [ ] #2 RED, seeded: a period of exactly one Vienna month with one entry -> revenue equals that entry to the cent. Change the period to 30 days spanning two months -> revenue covers only whole contained months and margin_bp is null with reason period_not_month_aligned
- [ ] #3 RED, seeded: a building with no entry for the period -> revenue_cents null, reason not_entered, margin null. Make it fall back to the contract -> the check goes red
- [ ] #4 RED, seeded: 'Dieses Jahr' picked mid-year no longer books unfinished months. Re-enable contract accrual -> the inflated-margin assertion goes red
- [ ] #5 DST is exercised: a period crossing the March and the October Vienna transitions selects the same months a Vienna calendar would
- [ ] #6 Integer cents throughout; the only division is numeric in SQL and is rounded once
- [ ] #7 check-api.js's P&L tests updated, not deleted; every existing decision-10 exclusion assertion still passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 (backlog/docs/VERIFY-FINAL.md).
node server/check-api.js -> PASS, including the Vienna DST pins ('23:30 on 31 October is October').
DEMO_BASE=http://127.0.0.1:8080 node demo/check-money.mjs -> all green: thisYear/thisQuarter/thisMonth each name the days that have not happened (133/41/11), say the cost is only partly recorded, put the warning on the margin CELL and not only in the block, and refuse to style it calm; lastMonth (closed) carries no future-days sentence at all.
Integer cents throughout, the only division is numeric in SQL and rounded once: SUM(ROUND(secs * hourly_rate_cents / 3600.0)) (server/lib/reporting.js:328).
CAVEAT, filed not hidden: that same ROUND makes labour_cents 0 for a one-second total. TASK-204.
<!-- SECTION:NOTES:END -->
