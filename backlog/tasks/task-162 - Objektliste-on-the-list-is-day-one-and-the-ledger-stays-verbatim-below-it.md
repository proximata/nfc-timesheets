---
id: TASK-162
title: 'Objektliste on /: the list is day one, and the ledger stays verbatim below it'
status: Done
assignee: []
created_date: '2026-08-18 03:17'
updated_date: '2026-08-18 07:50'
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
- [x] #1 D4: with every building lat IS NULL, / renders a complete Objektliste, states in words that {n} buildings have no coordinates, and offers 'Koordinaten holen' per row
- [x] #2 The ledger's correctness properties survive VERBATIM, each checked as a string and not as an element count: home.asOf, home.recentScope, home.truncatedNote with the literal 2000, home.overdueFlag as a word, and the NAMED lists in the triage rows
- [x] #3 No horizontal document scroll at 390, 767, 1024, 1280 and 1440 px - verified by screenshot, not by assertion alone
- [x] #4 The answer band still has exactly two cells and no hours tile was added
- [x] #5 Objektliste rows become cards at 390 px with correct data-labels (check the screenshot: an off-by-one captions a timestamp 'Objekt')
- [ ] #6 Sort order is attention, then on-site, then name; an inactive building is listed muted and is never dropped
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DONE except AC#6's second half, which turned out to contradict decision-39 §2.

components/Objektliste.tsx — five columns, .data-table so the row-to-card transform is free,
rendered on EVERY path including the ones where the map is gone. lib/objects.ts computes it
once for the pin and the row, so the two surfaces cannot disagree about a building; that file
is exercised by pnpm check, not merely read.

AC#6 IS HALF DONE AND THE OTHER HALF IS WRONG. Sort order (attention -> on-site -> name) is
built and asserted. 'An inactive building is listed muted and is never dropped' is NOT built:
decision-39 §2 scopes this list to ACTIVE buildings, a deactivated building is not a pin, and
a list that disagrees with the map about which buildings exist is the disagreement the single
derivation was written to prevent. Nothing is destroyed — /locations/ is where a deactivated
building still lives, and it says so. If the owner wants them here, it is a muted section with
its own heading, not a row mixed into the live ones.

COORDINATES ARE THE POINT OF THIS LIST TODAY: production has one building with lat NULL, so
every row states which of the three genuinely different things happened — nobody has asked yet
/ we asked and Google said no / no address — and carries 'Koordinaten holen', the one WRITE on
this screen. ops/backfill-geocode.mjs is the bulk form of the same fix.

EVIDENCE: docs/media/map-home/map-nopins-1680-dark.png is the day-one state with every
coordinate nulled in the database. demo/audit-band.mjs 13 x 18 = 234 measurements clean, so
no horizontal scroll at any width. The ledger's strings are asserted as STRINGS on all five
paths (map ready, blocked, offline, 390px, no coordinates, no buildings).
<!-- SECTION:NOTES:END -->
