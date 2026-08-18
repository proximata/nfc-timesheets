---
id: TASK-176
title: >-
  Payroll's „Nicht gezählt" cell reads 0 while a worker's wages are missing from
  the total
status: To Do
assignee: []
created_date: '2026-08-18 18:53'
updated_date: '2026-08-18 18:53'
labels:
  - ux
  - bug
  - money
dependencies: []
priority: high
ordinal: 94000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED. web/app/payroll/page.tsx sets the fourth answer cell to `v: excludedShifts`, where excludedShifts = unresolvedShifts + openShifts. A worker with no hourly rate is NOT in that number, but their hours are also not in 'Auszuzahlen'. So the cell that exists to say what is missing says nothing is missing.

Evidence (docs/media/states/, regenerate with STATES_PHASE=2 STATES_ONLY=norate node demo/shoot-states.mjs):
- payroll-1680-dark.png (nfc_demo as seeded): 'Auszuzahlen 3.638,26 EUR', 'Nicht gez\u00e4hlt 0', and Ana Ilic's 17,50 hours in the table as 'Nicht bewertet'.
- state-norate-payroll-lastmonth-1680-dark.png (the busiest worker made rate-less): 'Auszuzahlen 2.827,96 EUR' \u2014 810,30 EUR less \u2014 and the cell still reads 'Nicht gez\u00e4hlt 0'.

A second, smaller lie sits next to it: 'Stunden 267,25' includes the 72,25 hours that are not valued, so the two headline numbers are not consistent with each other and a director dividing one by the other finds a ~1.000 EUR gap with nothing on screen to explain it.

Everything else on this screen is already right and must not be touched: the caveat prose names the count and links to the fix, the per-row 'Nicht gez\u00e4hlt' column says 'Kein Stundensatz', and the CSV carries csvTotalNoRate. Seven of the eight surfaces are honest. Only the headline is not, and the headline is the one the answer band exists to be read alone.

FIX: count exclusions of every kind in the cell (shifts that block payroll PLUS workers with hours and no rate), and add the unvalued hours to the 'Stunden' cell's sub-line. Two expressions and one new key pair. Do not remove the prose caveat and do not change how any amount is computed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With at least one worker who has hours and no rate in the period, the 'Nicht gez\u00e4hlt' cell shows a non-zero value
- [ ] #2 With no unresolved shift, no open shift and every worker rated, the cell shows 0 and the sub-line says nothing is excluded
- [ ] #3 The 'Stunden' cell's sub-line names the hours that are not valued when there are any, and says nothing extra when there are none
- [ ] #4 The existing caveat bullets, the per-row column and the CSV note csvTotalNoRate are unchanged
- [ ] #5 No amount changes: the total, every row amount and the reconciliation line are byte-identical for a period with no rate-less worker
- [ ] #6 de.json and en.json gain the same keys with plural branches (demo/audit-icu.mjs passes)
- [ ] #7 Journey D7 (month-end payroll, JOURNEYS.md 2.D7): the four headline cells read alone cannot state a payout is complete when it is not
- [ ] #8 Journey D14 ('my hours are wrong'): the hours cell and the amount cell can be reconciled from the screen without opening the CSV
<!-- AC:END -->
