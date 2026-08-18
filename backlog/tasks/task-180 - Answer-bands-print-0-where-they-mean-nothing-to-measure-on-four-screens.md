---
id: TASK-180
title: 'Answer bands print 0 where they mean ''nothing to measure'', on four screens'
status: To Do
assignee: []
created_date: '2026-08-18 18:55'
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
