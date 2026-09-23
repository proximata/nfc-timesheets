---
id: TASK-347
title: Android manual start must select a zone after decision 69
status: Done
assignee: []
created_date: '2026-09-23 16:48'
updated_date: '2026-09-23 17:00'
labels: []
dependencies: []
type: bug
ordinal: 264000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real emulator manual start returns unknown_location because its picker sends a building UUID, while decision 69 retired building clock-in targets. Found during account-isolation verification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Manual start offers explicit building and zone labels and submits the selected zone UUID
- [x] #2 Both German and English explain zone selection and empty roster
- [x] #3 Real emulator starts and stops a shift against local API; server verification gate remains unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reuse cached roster zones, never map a building to an arbitrary first zone. Update bilingual picker wording. Build and drive ordinary manual start/stop, check database zone and manual flags.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Manual picker now offers explicit building and zone labels and posts selected zone UUID, respecting decisions 56 and 69 with unchanged server verification. DE/EN copy complete. Debug build passed. Real emulator selected Haus a / Eingang, ordinary start returned 201, normal stop succeeded; PostgreSQL confirms selected start_zone_id, manual_start/manual_close and end_time. Final A/B/A preserves own records. Read-only final decision/quality review reports no blockers; branding and diff checks clean.
<!-- SECTION:FINAL_SUMMARY:END -->
