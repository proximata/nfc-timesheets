---
id: TASK-349
title: Redesign Android worker experience with polished calm visual hierarchy
status: Done
assignee: []
created_date: '2026-09-23 17:20'
updated_date: '2026-09-23 18:00'
labels: []
dependencies: []
priority: high
ordinal: 266000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User authorizes substantial layout, color and motion changes. Cleaning workers need a clear attractive home, schedule, settings and material experience while existing clock-in and authentication behavior stays reliable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Chosen visual direction visibly improves home running shift settings language picker and material surfaces
- [x] #2 Operator entry remains five version taps with separate authentication and account data remains isolated
- [x] #3 New wording ships DE and EN; motion respects device animation settings and status meaning stays clear
- [x] #4 Build real emulator positive-negative journeys critic review and before-after screenshots are completed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Use the selected operational-clarity concept: state-led home card, compact NFC warning, clear primary action, upcoming schedule before recent rows, grouped account/preferences/sync and connected language controls. Preserve fixed active-shift blue, five version taps and all worker/operator isolation. Build and drive real emulator paths; capture before/after and request independent critique.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented operational-clarity visual direction: primary start card, next assignments before history, grouped preferences/account/sync, connected language radios with equal height, grouped materials composer, clear selected nav and corner badge. DE+EN strings complete. Sol agent drove real emulator cancel/start/stop at verified zone, draft persistence across tabs/language, empty disabled material form, DE/EN, own history and five-version-tap operator entry. Root verified final APK light/dark and fixed black system icons after live uiMode change with onConfigurationChanged enableEdgeToEdge (no NFC intent replay). Final builds pass, version-tap JVM gate passes. General core JVM gate retains 4 unchanged source-format/path checks (3 auth route assertions, Windows TagWriter path). Physical NFC and fresh two-account isolation not tested in this UI-only pass; data/session logic unchanged. Independent ALL-ADR/code-quality gate approved including final MainActivity fix. Actual captures and report under captures/company-workspaces/design-refresh/.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Redesigned worker home, settings/language, materials composer and navigation; shortened same-day schedule dates and fixed no-NFC guidance/system icon theme refresh. Built and exercised on Pixel_9 emulator; physical NFC remains device-only. Independent review approved. Before/after report saved.
<!-- SECTION:FINAL_SUMMARY:END -->
