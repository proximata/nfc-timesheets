---
id: TASK-139
title: 'Redesign foundation: nav regrouping, 12 flat entries into 3 groups'
status: In Progress
assignee: []
created_date: '2026-08-17 11:26'
updated_date: '2026-08-17 13:02'
labels:
  - ux
  - redesign
dependencies:
  - TASK-136
references:
  - docs/brand/prototype.html
documentation:
  - backlog/docs/REDESIGN-PLAN.md
priority: high
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/lib/nav.ts gains NAV_GROUPS; SidebarNav renders groups. Exact structure, group assignment and German/English labels in REDESIGN-PLAN.md section 3.

Top level, no visible heading: Uebersicht /, Schichten /shifts/, Material /material-requests/.
STAMMDATEN: Mitarbeiter, Objekte, Kunden, Vertraege, Produkte & Geraete.
AUSWERTUNG: Lohn, Ergebnis, Objektauswertung.
Pinned bottom via margin-top:auto, no visible heading: Konto.

All 12 entries survive. Nothing is hidden. /material-requests/ stays top-level and NOT under Stammdaten - the existing comment in nav.ts already says why: a worker is standing in a building WAITING on that queue, so it is a today problem, not a catalogue one. Keep that comment.

PRIMARY_NAV stays, derived as NAV_GROUPS.flatMap(g => g.items). One line, and it removes the temptation to grep-and-replace across files owned by other agents. FUTURE_NAV is empty and its .length === 0 guard is load-bearing - a 'Kommt spaeter' heading over an empty list reads as a sidebar that failed to load. Leave that machinery alone.

4 new message keys and 4 changed values, table in section 3.2. Write them to web/messages/_fragments/nav.de.json and nav.en.json. Foundation does NOT edit de.json or en.json either - the Merge agent is the only writer of those two files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 web/lib/nav.ts exports NAV_GROUPS with the exact grouping in REDESIGN-PLAN.md section 3, and PRIMARY_NAV derived from it
- [ ] #2 All 12 existing nav entries are still reachable; none was dropped or made non-navigable
- [ ] #3 Konto is pushed to the bottom of the sidebar with margin-top:auto
- [ ] #4 A group with no visible heading uses .visually-hidden, never display:none, and each <ul> is aria-labelledby its heading
- [ ] #5 aria-current="page" still lands on the active entry and is styled with --accent-weak
- [ ] #6 At <=767px the sidebar is still a horizontally scrolling strip and the PAGE does not scroll sideways; verified by looking at a 390px screenshot
- [ ] #7 New and changed nav strings are in web/messages/_fragments/nav.de.json and nav.en.json with identical key sets; de.json and en.json are untouched
- [ ] #8 FUTURE_NAV and its empty-list guard are unchanged
<!-- AC:END -->
