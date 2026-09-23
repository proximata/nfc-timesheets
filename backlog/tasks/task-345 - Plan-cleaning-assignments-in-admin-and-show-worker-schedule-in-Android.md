---
id: TASK-345
title: Plan cleaning assignments in admin and show worker schedule in Android
status: Done
assignee: []
created_date: '2026-09-23 15:43'
updated_date: '2026-09-23 16:33'
labels: []
dependencies: []
ordinal: 262000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Company administrators assign workers to locations and time windows; workers see their upcoming assignments. Plans are separate from actual NFC shifts and payroll.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Tenant-isolated create edit cancel and list APIs validate active workers locations and overlapping plans
- [x] #2 Admin can manage assignments and Android worker sees only own upcoming schedule in DE/EN
- [x] #3 Actual shifts, NFC access and pay remain independent from plans
- [x] #4 Database integration, browser and emulator verification documented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add planned_shifts table with FORCE RLS and composite tenant FKs, transactional overlap checks, admin schedule screen and worker API/Android home card. Test cross-company and concurrency paths and review all ADRs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Final browser pass found status notice retained previous language after switching DE/EN. Store message key and translate at render; verified saved notice switches live between Einsatz gespeichert and Assignment saved. Rebuilt web; lint/types/build pass; pnpm verify retains same four baseline Windows path failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented separate tenant-isolated planned assignments, admin week board, and Android own-schedule cards. Real PostgreSQL concurrency/isolation tests, browser create/edit/conflict/cancel, emulator cold-start/update/cancel and worker B empty schedule verified. See docs/product-launch-verification.md for checks and limitations. Unrelated existing local history exposure discovered during account switching is tracked as follow-up fix.
<!-- SECTION:FINAL_SUMMARY:END -->
