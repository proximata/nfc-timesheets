---
id: TASK-344
title: Shared calendar date range and week presets for admin reports
status: Done
assignee: []
created_date: '2026-09-23 15:43'
updated_date: '2026-09-23 16:15'
labels: []
dependencies: []
ordinal: 261000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace dated period controls with reusable calendar range picker and presets, preserving Vienna boundaries and cross-report URL state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shared picker offers last week and custom inclusive dates in German and English
- [x] #2 Report fetches, exports and cross-links preserve validated range boundaries
- [x] #3 Browser and date-boundary checks recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Extend central period/filter contract, replace report selectors, test DST and URL round trips, verify browser and pnpm verify.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Shared calendar picker with this/last week and inclusive custom dates now serves workspace, shifts, payroll, P&L and analytics. Added strict URL and Vienna/DST regression checks. Real browser on all five routes proved last-week exclusion, identical custom totals (1.5h/EUR22.50), range-preserving cross-links, DE/EN, invalid-date rejection. Types, lint and static build pass; pnpm verify retains four pre-existing Windows path assertion failures.
<!-- SECTION:FINAL_SUMMARY:END -->
