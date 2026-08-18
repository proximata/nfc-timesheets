---
id: TASK-162
title: 'Objektliste on /: the list is day one, and the ledger stays verbatim below it'
status: To Do
assignee: []
created_date: '2026-08-18 03:17'
labels:
  - ux
  - ia
  - map
dependencies:
  - TASK-161
documentation:
  - backlog/docs/MAP-HOME-SPEC.md
  - backlog/docs/IA-PLAN.md
  - backlog/docs/REDESIGN-INVENTORY.md
priority: high
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ZERO buildings in production have coordinates. The one live building predates the geocoding key (lat IS NULL, geocode_state = never_attempted). On the day the map ships it draws ZERO pins. So the list is NOT the map's fallback - the list is day one, and the map is a region that may or may not appear above it. Reasoning: decision-39 (PROPOSED). Spec: MAP-HOME-SPEC.md sections 5.1 and 6.

NEW LAYOUT OF /, in this order, same route, nothing moved to a new screen:
 1 PageHeader + the question
 2 AnswerBand, TWO cells (Zu erledigen / Vor Ort) - unchanged
 3 (map region - a later task)
 4 NEW: Objektliste, ALWAYS rendered
 5 Zu erledigen (AttentionList + moreToDo + clearNotes + truncatedNote)
 6 Vor Ort (oldest first, asOf, overdueFlag as a WORD)
 7 Zuletzt erfasste Schichten (10), recentScope

Objektliste: a .data-table so the row-to-card transform on phones comes free from ResponsiveTableLabels. MAX FIVE COLUMNS - Objekt | Vor Ort | Zuletzt gereinigt | Zu pruefen | (Oeffnen). More columns reproduce review defect R1 (horizontal scroll between 768 and 1439 px), which is the regression decision-28 exists to prevent. Sort: attention first, then on-site, then name. A building with no coordinates is a LIST ROW, never a pin, and its row states geocode_state in words with a 'Koordinaten holen' control (the existing geocodeLocation write).

NOTHING IS DELETED AND NOTHING MOVES. Blocks 5-7 keep their strings. Rejected alternative: move the ledger to a new /heute/ - it adds a 15th screen and makes the daily check two clicks, which is the complaint this work exists to end.

THE ANSWER BAND STAYS AT TWO CELLS. No 'Stunden diese Woche' (reads 0:00 on a Monday), no 'Stunden diesen Monat' (reads 0,00 EUR on the 3rd - already rejected once in web/app/page.tsx), no 'Objekte pruefen' (a second count of problemCount that can drift out of step with it).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 D4: with every building lat IS NULL, / renders a complete Objektliste, states in words that {n} buildings have no coordinates, and offers 'Koordinaten holen' per row
- [ ] #2 The ledger's correctness properties survive VERBATIM, each checked as a string and not as an element count: home.asOf, home.recentScope, home.truncatedNote with the literal 2000, home.overdueFlag as a word, and the NAMED lists in the triage rows
- [ ] #3 No horizontal document scroll at 390, 767, 1024, 1280 and 1440 px - verified by screenshot, not by assertion alone
- [ ] #4 The answer band still has exactly two cells and no hours tile was added
- [ ] #5 Objektliste rows become cards at 390 px with correct data-labels (check the screenshot: an off-by-one captions a timestamp 'Objekt')
- [ ] #6 Sort order is attention, then on-site, then name; an inactive building is listed muted and is never dropped
<!-- AC:END -->
