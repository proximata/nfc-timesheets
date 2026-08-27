---
id: TASK-186
title: >-
  check-filters.mjs waits for a .drawer that a keyed build never renders: it is
  green only in a build with no map key
status: Done
assignee: []
created_date: '2026-08-18 21:15'
updated_date: '2026-08-27 07:41'
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
- [x] #1 demo/check-filters.mjs exits 0 against a build made WITH the browser maps key, on seeded nfc_demo
- [x] #2 The Objektpanel step asserts whichever surface the build actually renders — .map-info when the map drew the pin, .drawer when it could not — and says in a comment why there are two, citing IA-PLAN §9
- [x] #3 The assertions after it (panel cross-links, chips, worker panel, EN) run and are measured in the keyed configuration, not skipped
- [ ] #4 The negative case is exercised: with the panel's links removed the run still goes red
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27 (read-only re-verification, no app code touched). Build made WITH the browser maps key from psst (2 chunks under web/out contain AIzaSy), API on 127.0.0.1:8080, freshly reseeded nfc_demo.

AC#1 GREEN: DEMO_BASE=http://127.0.0.1:8080 node demo/check-filters.mjs -> exit 0, last line 'check-filters: PASS'. The old death at line 133 is gone.

AC#2 the step now accepts either surface and asserts exclusivity - measured, on a keyed build the info box is what renders:
  ok   /?location=<uuid> opens the Objektpanel ON that building, in exactly one place  info box titled "Aerztezentrum Landstrasse", row said "Aerztezentrum Landstrasse Objektpanel oeffnen"
demo/check-filters.mjs:158-165 is the comment ('TWO RENDERINGS, ONE CONTRACT'). CAVEAT, and it is the only gap in this AC: it cites MAP-HOME-SPEC section 7 and STATE-GALLERY section 1, NOT 'IA-PLAN section 9' as the AC's wording asks. Same substance, different citation; checked on substance.

AC#3 everything after that step ran in the keyed configuration and was measured:
  ok   Objektpanel: EVERY link out of it carries a filter  10 links, all filtered
  ok   Objektpanel: the filter is echoed as a chip naming the building  Objekt: Aerztezentrum Landstrasse
  ok   Objektpanel link: payroll, this building, last month  /payroll/?location=fe0005c5-...&period=lastMonth
  ok   back closes the panel it opened (open = push)  search="" drawer=false
  ok   English: the chip is translated, not a German string in an English screen  Building: Aerztezentrum Landstrasse
  ok   English: the Mitarbeiterpanel renders no message key as text

AC#4 LEFT UNCHECKED, not disproven: exercising the negative case means removing the panel's links from web/ source and rebuilding, which this read-only audit was forbidden to do. Not re-proven this session.

Status left Done.
<!-- SECTION:NOTES:END -->
