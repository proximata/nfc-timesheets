---
id: TASK-266
title: >-
  Admin: Mindestens 0 m2 states a measurement of zero where it means not
  measured yet
status: To Do
assignee: []
created_date: '2026-08-24 19:08'
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
