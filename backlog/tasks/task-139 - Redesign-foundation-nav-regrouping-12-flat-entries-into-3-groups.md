---
id: TASK-139
title: 'Redesign foundation: nav regrouping, 12 flat entries into 3 groups'
status: Done
assignee: []
created_date: '2026-08-17 11:26'
updated_date: '2026-08-17 13:31'
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
- [x] #1 web/lib/nav.ts exports NAV_GROUPS with the exact grouping in REDESIGN-PLAN.md section 3, and PRIMARY_NAV derived from it
- [x] #2 All 12 existing nav entries are still reachable; none was dropped or made non-navigable
- [x] #3 Konto is pushed to the bottom of the sidebar with margin-top:auto
- [x] #4 A group with no visible heading uses .visually-hidden, never display:none, and each <ul> is aria-labelledby its heading
- [x] #5 aria-current="page" still lands on the active entry and is styled with --accent-weak
- [x] #6 At <=767px the sidebar is still a horizontally scrolling strip and the PAGE does not scroll sideways; verified by looking at a 390px screenshot
- [x] #7 New and changed nav strings are in web/messages/_fragments/nav.de.json and nav.en.json with identical key sets; de.json and en.json are untouched
- [x] #8 FUTURE_NAV and its empty-list guard are unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
lib/nav.ts gains NAV_GROUPS (4 groups: hidden Heute, Stammdaten, Auswertung, hidden+pinned Konto); PRIMARY_NAV is derived with flatMap and still exported. FUTURE_NAV and its length===0 guard untouched. The comment explaining why /material-requests/ stays top-level is kept verbatim.

SidebarNav renders one <p class=nav-group-heading> + <ul aria-labelledby> per group. A hidden heading is .visually-hidden and never display:none, at every width including the phone strip.

Group labels are in web/messages/_fragments/foundation.de.json / .en.json, NOT in de.json/en.json -- read at runtime through lib/pendingMessages.ts, which is typed off the fragment so the two locales must stay at key parity, and which BREAKS THE BUILD when the Merge agent deletes _fragments/. That is deliberate: a silent fallback would leave two copies of the same German string drifting for a year.

The four CHANGED nav values (Lohn, Ergebnis, Material, Vertraege) are in the same fragment and land at merge; until then the sidebar shows the old longer labels. Screenshotted both ways.

Phone (AC#6) verified at a REAL 390px and 360px viewport -- the first version of the check measured 390px against a 1303px viewport because Emulation.setDeviceMetricsOverride with mobile:true silently hands this page a 1304px layout viewport. setViewport now reads window.innerWidth back and throws if it does not match. With the viewport actually applied the check found a real regression: the visually-hidden group heading escaped the scroll strip and widened the document to 1305px. Fixed with .nav-group { position: relative }; now 390/390 and 360/360, and all 12 links are still in the strip.
<!-- SECTION:NOTES:END -->
