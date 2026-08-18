---
id: TASK-163
title: 'Objektpanel: /?location=<uuid> is the building object surface'
status: To Do
assignee: []
created_date: '2026-08-18 03:18'
labels:
  - ux
  - ia
  - map
dependencies:
  - TASK-160
  - TASK-161
  - TASK-162
documentation:
  - backlog/docs/MAP-HOME-SPEC.md
  - backlog/docs/IA-PLAN.md
priority: high
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE NEW IA OBJECT. Opened by a pin click or an Objektliste row; addressable as /?location=<uuid> so it can be linked TO (decision-38: a query parameter, not a dynamic route - the admin is a static export). Full specification: MAP-HOME-SPEC.md section 3.

FIVE CELLS, chosen by JOURNEYS section 8 rank and NOT by what the PoC drew:
 N1 Gerade vor Ort   - names, seit HH:MM, zone. Frozen at load (home.asOf applies here too). >=8h shows overdueFlag as a WORD.
 N2 Offene Punkte hier - {u} nicht bestaetigt, {o} offen, {m} Material. NO PERIOD FILTER: an unresolved shift from March is an open point today. This is the cell the PoC does not have, and it is what turns the map from a report into a work surface - it starts D5, the third-ranked journey.
 N3 Zuletzt gereinigt - relative age, worker, zone, duration. 'noch nie' is a real answer, not an error. From SQL, never from the capped shift list.
 N4 Stunden diesen Monat / Monatsziel - target NULL renders 'Kein Monatsziel vereinbart', NOT 0 percent. The variance flag is SUPPRESSED before day 10 of the month: on the 3rd every building is 90 percent 'behind' and that is a property of the calendar.
 N5 Vertrag / Marge letzter Monat - NEVER a confident zero for unknown revenue (a zero reports a paying client as a total loss). Margin from server SQL only. Carries the rate_basis caveat (decision-28, proposed).

ELEVEN CROSS-LINKS, each carrying state - the full table is IA-PLAN.md section 3, rows L1 to L11. Every one obeys the three rules: never link to an empty target, state the filter in the label, and the target echoes it as a removable chip.

BEHAVIOUR: aria-labelledby the building name. Desktop: non-modal right panel, 408 px, translateX 200 ms. Esc closes and returns focus to the opener; clicking the map closes it. Phone layout is a separate task. Selecting an Objektliste row pans and selects the matching pin, so the two surfaces never disagree about what is open.

The zone block is a SEPARATE task (needs the zones migration). Until it lands, a building renders one stated line: 'Keine Zonen angelegt. Dieses Objekt verhaelt sich wie bisher: ein Ort, ein Tag.'

Street View: read the STORED locations.street_view_status column. Never call the metadata endpoint from the browser. One image per panel open at most, source=outdoor (without it Street View returns user-contributed INDOOR panoramas - the PoC's first run put a stranger's office wall in the panel). Today the API is disabled, so the correct render is the text 'Keine Strassenansicht' and the cost is zero.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 D5 in one action: from / a director opens a building, sees the named worker with the open shift, and reaches /shifts/?location=<uuid>&period=all&state=open&shift=<id> in ONE click
- [ ] #2 All eleven links from IA-PLAN.md section 3 (L1-L11) are present, each carries its state, and a link whose target would be empty is NOT rendered - the zero is stated in words instead
- [ ] #3 N2 applies NO period filter: an unresolved shift older than 30 days is counted and linked
- [ ] #4 N4 with target_minutes NULL renders 'Kein Monatsziel vereinbart' and never 0 percent; the variance flag does not appear before day 10 of the month
- [ ] #5 N5 with unknown revenue renders revenueUnknown and never 0,00 EUR
- [ ] #6 Esc closes the panel and focus returns to the row or pin that opened it; /?location=<uuid> opened cold in a new tab renders the panel for that building
- [ ] #7 A building with no zones renders the stated one-line sentence, in de and en, and prints no zone hours and no zone euros
- [ ] #8 Zero Street View metadata requests are made from the browser; with the API disabled the panel shows 'Keine Strassenansicht'
<!-- AC:END -->
