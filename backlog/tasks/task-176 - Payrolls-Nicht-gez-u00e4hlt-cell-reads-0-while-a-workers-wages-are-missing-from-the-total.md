---
id: TASK-176
title: >-
  Payroll's „Nicht gezählt" cell reads 0 while a worker's wages are missing from
  the total
status: Done
assignee: []
created_date: '2026-08-18 18:53'
updated_date: '2026-08-18 19:34'
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
- [x] #1 With at least one worker who has hours and no rate in the period, the 'Nicht gez\u00e4hlt' cell shows a non-zero value
- [x] #2 With no unresolved shift, no open shift and every worker rated, the cell shows 0 and the sub-line says nothing is excluded
- [x] #3 The 'Stunden' cell's sub-line names the hours that are not valued when there are any, and says nothing extra when there are none
- [x] #4 The existing caveat bullets, the per-row column and the CSV note csvTotalNoRate are unchanged
- [x] #5 No amount changes: the total, every row amount and the reconciliation line are byte-identical for a period with no rate-less worker
- [x] #6 de.json and en.json gain the same keys with plural branches (demo/audit-icu.mjs passes)
- [x] #7 Journey D7 (month-end payroll, JOURNEYS.md 2.D7): the four headline cells read alone cannot state a payout is complete when it is not
- [x] #8 Journey D14 ('my hours are wrong'): the hours cell and the amount cell can be reconciled from the screen without opening the CSV
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
FIXED as specified: the cell counts exclusions of every kind (shifts that block payroll
PLUS workers whose hours carry no rate), and the "Stunden" cell's sub-line names the hours
that are not valued. Two expressions and two key pairs (payroll.answerHoursUnvalued in
de/en). The caveat bullets, the per-row column, exclusionNote and csvTotalNoRate are
untouched.

MEASURED on nfc_demo, period Voriger Monat, read off the rendered screen:

  state                          Auszuzahlen   Nicht gezaehlt   Stunden sub-line
  as seeded (Ana Ilic no rate)   3.638,26 EUR  0 -> 1           + "davon 17,50 nicht bewertet"
  every worker rated             3.892,01 EUR  0    0           unchanged, nothing added
  busiest worker made rate-less  3.081,71 EUR  0 -> 1           + "davon 54,75 nicht bewertet"

810,30 EUR left the payout between rows two and three and the cell said 0 both times. No
amount moved: all three payout totals are byte-identical before and after the change, and
267,25 hours is the same number in every state - only what the screen SAYS about it
changed. 267,25 - 54,75 = 249,75 valued hours is now derivable from the band alone
(journey D14).

THE SAME SHAPE, CHECKED EVERYWHERE ELSE ON BOTH SCREENS. "A count of the wrong noun that
reads as reassuring" - each one inspected, and what it counts:

/payroll/
- band "Nicht gezaehlt"      WRONG, fixed. Counted shifts, labelled as everything omitted.
- band "Stunden"             sub said only "Nur Schichten mit bestaetigter Endzeit", which
                             is true and incomplete: the total includes hours that carry no
                             amount. Fixed by naming them, not by changing the number.
- band "Mitarbeiter"         RIGHT. Counts the lines in the table below it, which is every
                             person with any shift in the period including the rate-less
                             and the ones with only an open shift. Same number as the row
                             count; it claims nothing about who was paid.
- band "Auszuzahlen"         RIGHT. Money, not a count, and its sub names its period.
- table column "Nicht        RIGHT. exclusionNote already names all three conditions
  gezaehlt" per row          (unresolved, open, no rate) and is the same function the CSV's
                             last column reads.
- caveatNoneExcluded         RIGHT, and narrowly so. "Keine Schicht ... ist offen oder
                             wartet auf Bestaetigung - AUS DIESEN GRUENDEN fehlt nichts."
                             It is scoped to shifts in its own words and caveatNoRate is a
                             separate bullet, so the two cannot both be silent.
- caveatUnresolved / Open    RIGHT. Shifts, and they link to those shifts.
- caveatManual               RIGHT. Shifts, and they are INCLUDED in the total, stated.
- caveatNoRate               RIGHT. People. The band's new count reuses this exact number
                             rather than computing a second one.
- caveatTruncated / Reconcile RIGHT. A row limit and two amounts.
- caveatOrphan               RIGHT. No count, and it should not have one.
- csvTotalNoRate             RIGHT. People, and the same count again.

/pl/
- band "Unter der Zielmarge" RIGHT NOUN (buildings), and its sub names the buildings that
                             could not be assessed. The separate complaint that 0 means two
                             different things here is TASK-180, not this shape.
- band "Umsatz" sub          RIGHT. totalScope counts buildings WITH a contract, and the
                             ones without are named in methodNoContract with their cost.
- rowExcluded                RIGHT. Shifts, per building.
- labourUnpriced (row)       RIGHT. Workers and hours, attached to the amount they qualify.
- methodUnpricedLabour       RIGHT, and deliberately so: workers is the server's DISTINCT
                             head count, buildings is the per-building count, and the
                             comment at the query says why the two may not be summed.
- methodNoContract           RIGHT. Buildings plus the cost they carry.
- methodUnpriced             RIGHT. Material requests.
- totalNotAssessable         RIGHT. Buildings.
- whyExcluded / whyOpen      RIGHT. Shifts plus the hours behind them.

VERIFICATION: demo/check-money.mjs seeds all three states above, restores nfc_demo from a
pg_dump taken before the first UPDATE, and fingerprints the hourly rates as well as the row
counts - a rate left at 0 does not change any row count, so row counts alone would not
notice. 19 red before the fix, 0 after; the three negative-case assertions (cell is 0 and
calm, sub names no person, hours sub-line says nothing extra) were re-run against a build
with the conditions forced on and all three went red. demo/check-reports.mjs is unchanged
in outcome by this work (see TASK-184 for its two pre-existing failures).

CORRECTION to the last line of the notes above: the two pre-existing demo/check-reports.mjs failures are filed as TASK-185, not TASK-184. TASK-184 is the contract-accrual clipping filed by TASK-175.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Payroll's 'Nicht gezaehlt' counts exclusions of every kind now (blocked shifts PLUS workers whose hours carry no rate) and 'Stunden' names the part of itself that carries no amount, so the two headline numbers reconcile from the band alone. 810,30 EUR left the payout in the seeded test and the cell said 0 both times; it says 1 now, with the person named underneath. No amount changed in any state. The caveat prose, the per-row column and csvTotalNoRate are untouched. Every other counted exclusion on /payroll/ and /pl/ was inspected for the same shape and listed in the notes; all of them count the right noun.
<!-- SECTION:FINAL_SUMMARY:END -->
