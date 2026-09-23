---
id: TASK-350
title: >-
  Replace admin appearance and language dropdowns with polished segmented
  controls
status: Done
assignee: []
created_date: '2026-09-23 17:20'
updated_date: '2026-09-23 18:00'
labels: []
dependencies: []
priority: medium
ordinal: 267000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User dislikes native dropdowns for theme and language and authorizes improvements to existing admin chrome. Preserve system theme and both locales with accessible direct controls.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Theme System Light Dark and language DE EN use clear keyboard-accessible segmented controls
- [x] #2 Selection persists and theme transitions respect reduced motion without first-paint flash
- [x] #3 Header and navigation look cohesive in light and dark themes on supported admin widths
- [x] #4 Real browser keyboard persistence locale and visual checks plus pnpm verify are recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Replace selects with native radio-based segmented controls using existing persisted theme/locale state. Preserve System mode and prepaint script. Use icon+label theme segments and compact DE/EN; add scoped motion with reduced-motion override. Verify keyboard arrows, reload persistence, dark/light, locale and admin shell scrolling in a real browser.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Native radio fieldsets replace appearance/locale selects. System/Dark/Light and DE/EN share accessible segmented control; selected contrast, focus ring and reduced-motion-aware transitions. Existing prepaint initialization, localStorage persistence and System listener retained. Root actual IAB: mouse and ArrowRight change checked state/theme, EN persists reload, Dark+DE persist reload, System resolves to observed OS dark, content scrollTop692 while rootY0/headerTop0. No browser console errors. Light/dark screenshots saved. Independent review pending.

Independent Chrome verification logged into local synthetic Clean A: native theme radio click + ArrowRight, language arrows and translated content, Dark+EN persistence after reload all passed. Final review across 65 ADRs approved. No new dependencies/API changes. Build/typecheck/Biome pass, verify retains four pre-existing Windows path failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced theme/language dropdowns with native accessible segmented radio controls, icons and reduced-motion-aware transitions. Preserved System following and prepaint/persistence logic. Independent browser and root IAB checks confirm keyboard behavior, DE/EN, persistence and fixed header scrolling; screenshots/report saved.
<!-- SECTION:FINAL_SUMMARY:END -->
