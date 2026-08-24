---
id: TASK-266
title: >-
  Admin: Mindestens 0 m2 states a measurement of zero where it means not
  measured yet
status: To Do
assignee: []
created_date: '2026-08-24 19:08'
updated_date: '2026-08-24 22:45'
labels:
  - web
  - ux
  - zones
dependencies: []
priority: low
ordinal: 184000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, step 'Reach /tags/ and resolve the reported tag into a new zone Haupteingang on the new building', reading the building summary afterwards.

MEASURED: when a building's only zone has no area entered, the summary reads 'Mindestens 0 m2 - 1 Zone ohne Flaechenangabe'. Literally it claims a measurement of zero square metres. What it means is that nothing has been measured yet.

The underlying data handling is CORRECT and must not be touched: NULL area is distinct from zero, the building area is SUM() and never stored, and the 'at least N m2' template is right whenever at least one zone HAS a number (decision-43, backlog/docs/ZONES-MODEL.md). Only the zero-known-zones branch needs its own sentence instead of reusing the template with N=0.

WHY IT MATTERS FOR UAT: it lands on a brand-new building, i.e. on the very first thing an owner sees after onboarding, which is the moment the panel should look most trustworthy. A number that is precisely wrong is worse than an honest absence — and per-square-metre figures elsewhere in the product depend on this same area, so a reader who believes the 0 has a reason to distrust those too.

SAME PATTERN, DIFFERENT SCREENS: TASK-180 is the open task for answer bands printing 0 where they mean nothing to measure, on /pl/, /analytics/ and /. If both are picked up together, use one shared decision about how this product renders an unmeasured quantity — but do not fold this into TASK-180's acceptance criteria, they are different components.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A building whose zones all have NULL area shows a sentence saying the area is not recorded yet, not Mindestens 0 m2
- [ ] #2 A building with at least one measured zone still reads Mindestens N m2 exactly as today
- [ ] #3 The count of zones without an area entry stays on the line — nothing true is dropped
- [ ] #4 NULL versus zero handling in the data layer is untouched (decision-43, ZONES-MODEL.md)
- [ ] #5 de.json and en.json gain the same keys with exact parity, including plurals
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 22:45
---
VERIFIED independently at d11bb36 (web-verify): 4 of 5 ACs hold, AC#1 holds on /locations/ ONLY. STAYS To Do. HOLDS: AC#2 - areaSentence() in app/locations/page.tsx:1199-1207 guards on sum.hundredths === 0 inside state==='incomplete'; parseAreaToHundredths returns >0 or null, so hundredths===0 is equivalent to zero measured zones, and any building with >=1 measured zone still falls through to the unchanged areaFloor call ('Mindestens N m2 ...'). Both call sites (page.tsx:1385 zone drawer, :1739 list row) share that one function. AC#3 - the unmeasured count is on BOTH branches: areaAllUnmeasured takes zones=sum.unmeasured, same argument areaFloor already took. AC#4 - lib/area.ts is not in the commit (3 files only: de.json, en.json, app/locations/page.tsx); sumArea/AreaSum/state enum/NULL-vs-zero untouched, decision-43 gates in scripts/check.mjs still pass. AC#5 - locations.areaAllUnmeasured exists in de.json and en.json with the same ICU one/other branches; rendered via intl-messageformat: DE 'Noch keine Flaeche erfasst - 1 Zone ohne Flaechenangabe' / '2 Zonen ohne Flaechenangabe', EN 'No area recorded yet - 1 zone has no area on file' / '2 zones have no area on file'. Gates re-run by verifier: tsc --noEmit exit 0; biome check exit 0 (1 pre-existing warning in untouched app/payroll/page.tsx:749); node scripts/check.mjs 'All checks passed' incl. key-parity, ICU-argument and plural-branch gates; pnpm build exit 0, 18 routes static. GAP (AC#1, exact): components/BuildingFacts.tsx has its OWN copy of areaSentence (lines 137-148) and was not touched. It has no zero-guard, so a building whose live zones all have NULL area still renders home.panelZonesFloor, which formats to DE 'mindestens 0 m2 aus 1 Zone - 1 Zone ist noch nicht vermessen' / EN 'at least 0 m2 across 1 zone - 1 zone has not been measured'. That is the same 0-that-means-not-measured this task forbids, on the building panel of / (app/page.tsx:555) and in the map drawer (components/HomeMap.tsx). It is NOT covered by TASK-180, whose ACs are all about AnswerBand cells, and this task's own description says the two are different components. FIX: mirror the /locations/ guard - add a home.panelZonesAllUnmeasured key to de.json and en.json (same one/other plural shape, keep the zone count and the unmeasured count that the current sentence carries) and branch on sum.hundredths === 0 inside the incomplete branch of BuildingFacts.tsx's areaSentence. Do not touch lib/area.ts. Re-close when / shows the honest sentence for an all-unmeasured building.
---
<!-- COMMENTS:END -->
