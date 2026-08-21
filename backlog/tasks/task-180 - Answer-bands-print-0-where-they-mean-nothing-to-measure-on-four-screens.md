---
id: TASK-180
title: 'Answer bands print 0 where they mean ''nothing to measure'', on four screens'
status: To Do
assignee: []
created_date: '2026-08-18 18:55'
updated_date: '2026-08-21 02:56'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One pattern, four screens, all photographed. The answer band's job is to be read alone, and when there are no rows at all it reads as an all-clear.

- state-empty-pl-1680-dark.png: 'Unter der Zielmarge 0' with the sub 'Alle Objekte konnten beurteilt werden' \u2014 over ZERO objects. /pl/'s own callout on the same page says 'nicht beurteilbar' ist nicht dasselbe wie 'in Ordnung', and then its answer band does exactly that.
- state-empty-analytics-1680-dark.png: 'Ueber der vereinbarten Zeit 0' and 'Unter der vereinbarten Zeit 0' over zero buildings.
- pl-1680-dark.png (seeded data, no baseline): 'Unter der Zielmarge 0' with '6 Objekte sind nicht beurteilbar'. Nothing is flagged because nothing CAN be flagged.
- state-empty-home-1680-dark.png: 'Zu erledigen 0' on a database with nothing in it.

Each sub-line is honest. The number above it is not, because 0 in this product means two different things and the typography gives the reassuring one the large type.

FIX: let AnswerBand accept a string value and pass an em dash when the denominator is zero (no rows, or no baseline set), keeping the sub-line exactly as it is. One component signature, four call sites. Payroll's 'Auszuzahlen 0,00 EUR' on an empty ledger is NOT in scope: with no shifts, zero really is the amount to pay.

DO NOT delete or shorten any sub-line. They are the part that is already right.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 AnswerBand accepts a non-numeric value for a cell
- [ ] #2 On a database with zero buildings, /pl/ and /analytics/ show an em dash rather than 0 in the cells whose denominator is zero
- [ ] #3 With no margin baseline set, /pl/'s 'Unter der Zielmarge' cell is not a numeral
- [ ] #4 With zero rows, /'s 'Zu erledigen' cell is not a numeral
- [ ] #5 Every sub-line under every affected cell is unchanged, word for word
- [ ] #6 When there ARE rows and the count genuinely is zero, the cell still shows 0 (an all-clear that is a real all-clear must still read as one)
- [ ] #7 Journey D4 (JOURNEYS.md 2.D4) and D8 (2.D8): a screen with nothing to measure cannot be read as a screen with nothing wrong
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIAL PROGRESS 2026-08-21, from the Fix/LOOK run (LOOK.md W4): AC #3's specific case (no margin baseline set -> /pl/'s 'Unter der Zielmarge' cell is not a numeral) is now handled, generalised slightly beyond just the no-baseline case: whenever totals.notAssessable === buildings.length (every building unassessable, for ANY reason — no baseline is the one that occurs in production today), the cell reads 'Nicht beurteilbar' instead of a bare 0. Mechanism differs from the task's own suggestion: a translated word (answerFlaggedNoneAssessable) rather than an em dash, judged more actionable than a dash on a screen already carrying other worded states (marginUnknown = 'Nicht berechenbar', assessNoBaseline). AC #6 preserved: still a real 0 when some buildings WERE assessed and genuinely cleared the bar. Verified RED->GREEN by demo/check-pl-vacuous.mjs, commit 1267c1d.

STILL OPEN: AC #2 (the zero-BUILDINGS case on /pl/ and /analytics/ — a different vacuous denominator than the one this run fixed; with 0 buildings, totals.notAssessable is also 0, so my guard does not fire and the cell still reads a bare 0), AC #4 (/'s 'Zu erledigen' cell), and generalising AnswerBand itself to accept a non-numeric value per the task's original FIX proposal. /analytics/ untouched entirely.
<!-- SECTION:NOTES:END -->
