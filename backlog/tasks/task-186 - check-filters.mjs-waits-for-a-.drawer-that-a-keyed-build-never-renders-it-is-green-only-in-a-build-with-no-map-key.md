---
id: TASK-186
title: >-
  check-filters.mjs waits for a .drawer that a keyed build never renders: it is
  green only in a build with no map key
status: To Do
assignee: []
created_date: '2026-08-18 21:15'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED while verifying TASK-177/178/179, and NOT caused by them. `demo/check-filters.mjs` dies at step 2 against a build made WITH NEXT_PUBLIC_GOOGLE_MAPS_KEY:

  ok   locations: the building name links to its object surface, carrying the uuid  /?location=1965d9e3-…
  Error: timed out waiting for: the Objektpanel   (demo/check-filters.mjs:133)

Line 133 is `page.waitFor("document.querySelector('.drawer')")`. On a keyed build that element does not exist and MUST not: web/app/page.tsx computes `panelOnMap = mapDrawn && isPinned(building)` and renders the selected building as the info box ON THE PIN, with `<BuildingPanel building={panelOnMap ? null : …}>` — the owner's chosen presentation (IA-PLAN §9), and `.map-info` and `.drawer` are deliberately never on screen together.

PROVED BOTH WAYS on the same commit and the same seeded nfc_demo:

  keyed build    (NEXT_PUBLIC_GOOGLE_MAPS_KEY set)   check-filters exit 1, timeout on '.drawer'
  keyless build  (no key -> noKey -> drawer fallback) check-filters exit 0, PASS

And on the state the deep link actually renders, the contract it is meant to protect HOLDS — read off the rendered page at /?location=<uuid>, 1680: 11 cross-links in `.panel-links-out`, chip 'Objekt: Aerztezentrum Landstrasse' present, URL carries the uuid. demo/check-map-home.mjs asserts that same box and its links and is green on all of it.

So the check is not finding a defect, it is describing a screen this project stopped shipping when the map became the landing surface. It also means every filter assertion AFTER line 133 — the panel's eleven links, the worker panel, the chips, the EN pass — has not run against a keyed build for as long as that has been true, which is the real cost.

Also PRE-EXISTING: reproduced identically at c41d33f, before the reach commit and before the money commits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 demo/check-filters.mjs exits 0 against a build made WITH the browser maps key, on seeded nfc_demo
- [ ] #2 The Objektpanel step asserts whichever surface the build actually renders — .map-info when the map drew the pin, .drawer when it could not — and says in a comment why there are two, citing IA-PLAN §9
- [ ] #3 The assertions after it (panel cross-links, chips, worker panel, EN) run and are measured in the keyed configuration, not skipped
- [ ] #4 The negative case is exercised: with the panel's links removed the run still goes red
<!-- AC:END -->
