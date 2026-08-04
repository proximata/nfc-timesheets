---
id: TASK-22
title: Payroll summary view
status: In Progress
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-04 16:49'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-20
  - TASK-18
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per worker: hours x hourly rate = payroll amount. Period selector (5 periods). Read-only aggregation. Excludes needsCorrection shifts with visible warning count. Respects rate effective_from dates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each worker row: name, hours, rate, gross pay
- [x] #2 Total row at bottom
- [x] #3 Period selector works
- [x] #4 needsCorrection shifts excluded with visible count
- [ ] #5 Correct rate per shift based on effective_from
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — THE SCREEN IS DONE. ONE CRITERION IS BLOCKED BY TASK-20.

MET. `curl https://timesheets.exe.xyz/payroll/` -> 200, `<h1>Lohnabrechnung</h1>`.
web/app/payroll/page.tsx + web/lib/payroll.ts.
AC1/AC2: per-worker name, hours, rate, gross, plus a totals row.
AC3: five periods, shared with the shifts screen (web/lib/period.ts).
AC4: web/lib/payroll.ts buckets unresolved and open shifts away from payable and surfaces
`caveatUnresolved` / `caveatOpen` with counts and links to the offending rows.
Money arithmetic is integer-safe on purpose: `Math.round((payableMs * hourly_rate_cents) /
3_600_000)` — milliseconds x cents, divided once, rounded once, matching the server SQL to the
cent (payroll.ts:118). A rate a cent out is wrong on every payslip.
Frame: docs/media/admin-payroll.png.

NOT MET — AC5. "Correct rate per shift based on effective_from" is impossible: there is no rate
history to read (see TASK-20). Every shift is priced at the worker CURRENT rate.
The screen says so itself rather than pretending otherwise: `payroll.caveatRateHistory`.

This task closes the moment TASK-20 ships `worker_rates`. Nothing else here is outstanding.
<!-- SECTION:NOTES:END -->
