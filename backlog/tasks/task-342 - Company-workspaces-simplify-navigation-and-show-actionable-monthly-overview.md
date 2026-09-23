---
id: TASK-342
title: 'Company workspaces: simplify navigation and show actionable monthly overview'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-22 12:02'
updated_date: '2026-09-23 15:00'
labels:
  - web
  - reporting
dependencies:
  - TASK-341
ordinal: 259000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Approved doc-1: company owners get five primary destinations and an overview using existing authoritative shifts, rates and material requests. Preserve access to advanced existing functionality through contextual links. Do not call estimated current-rate accrual a payment balance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Company navigation exposes overview, workers, buildings, calculations and materials with secondary settings and contextual advanced links.
- [x] #2 The overview shows a consistent selected month, truthful accrual and data freshness plus actionable setup and operational issues.
- [x] #3 German and English UI, real browser verification and pnpm verify evidence accompany the change.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add role-aware navigation while preserving advanced destinations contextually. 2. Aggregate company-only monthly facts and label current-rate estimates clearly. 3. Browser-check both locales, keyboard, empty and populated states; run pnpm verify.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Final browser PASS: company root lands overview, legacy filtered root opens preserved map and selected building, month filter/material orders/estimated pay agree with local database, DE/EN and company-only lists work. Earlier browser pass also covered 390px/light/dark. Screenshots/gallery captures/company-workspaces/index.html. pnpm verify executed: four pre-existing Windows path assertions fail; separators intentionally unchanged. Separate lint (one existing payroll optional-chain warning), typecheck and build pass. Branding OK without TODO. Dedicated ADR/code review PASS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered five-section company navigation and monthly overview with hours, estimated current-rate pay, material orders, weekly chart and next actions. Kept operational map and advanced links. Real browser and database evidence saved; known Windows verification limitations documented.
<!-- SECTION:FINAL_SUMMARY:END -->
