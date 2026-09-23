---
id: TASK-360
title: 'Android: polished worker experience and tap-to-shift transition'
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 18:27'
updated_date: '2026-09-23 18:55'
labels: []
dependencies: []
ordinal: 280000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner prefers Calm Order concept: soft surfaces, coherent type, purposeful vector illustrations and smooth shift time-card reveal. Compare designs with critic and preserve identity, NFC verification and accounting.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Three concepts compared and chosen direction documented with critic feedback.
- [x] #2 Home, active shift, materials, history and settings share rounded readable styling in DE and EN, light and dark.
- [x] #3 Shift reveal uses actual location and time, respects reduced motion and preserves offline and error states without delaying writes.
- [x] #4 Real emulator journeys and before-after captures verify affected actions and operator entry; physical NFC limits stated.
- [x] #5 Build, branding, tests and independent ADR review recorded, separate commits without push.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect state and capture baseline. 2. Compare three concepts with critic. 3. Extract presentation components and implement rounded surfaces, vectors and typography. 4. Add state-driven shift reveal preserving accounting. 5. Test emulator actions, themes, languages, large text and disabled motion. 6. Review all ADRs and diff, fix findings, record evidence and commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Independent critic compared Calm Route, Working Route timeline and Illustrated Journal; selected Calm Route. Implemented native entrance/supplies drawings, rounded worker surfaces, compact first assignment with persistent refresh, localized day heading, 320ms state-based timecard and 180ms confirmed check fade. Build and branding pass. DE/EN changed keys match. pnpm verify retains 4 pre-existing Windows path failures; Android core-check retains 3 old auth declaration assertions and 1 Windows TagWriter path assertion; other five JVM check groups pass. Dedicated real-emulator verifier and final ADR reviewer running.

Independent final gate read all ADRs and final diff: no introduced contradiction or required finding. Real emulator verified manual cancel/start/stop, verified-zone intent open/close, materials draft and one real request, history, DE/EN, dark theme, font 200%, animator scale zero and five-tap operator gate. Fixed status icons on blue field; final APK SHA256 F79A5C8411917BFECC1C86E50AC9BDD3C6AFDEC606CA916740AF1B8A70572D05. Parent additionally opened My hours, observed server rows, returned and restored DE. Final local DB after video capture: 10 shifts, 0 open, 5 corrected; Test mops submitted once. Unknown-tag blocked local row preserved and tracked TASK-362. Limits: physical NFC and ScanActivity not driven on no-NFC emulator, empty/offline schedule not driven. Six focused JVM check groups including worker-reader pass; core and web baseline failures documented. Report captures/company-workspaces/android-polish/report.html; runtime matrix, screenshots and tap-final.mp4 in verification subfolder.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Calm Route worker presentation and finite real-shift reveal in b7eca84. Native vectors, rounded surfaces, compact schedule, accessible timer and status icon contrast. Verified on local emulator with independent design/ADR gate; build, branding and focused checks pass. Known baseline check failures and inherited unknown-tag recovery defect explicitly recorded. No push or deployment.
<!-- SECTION:FINAL_SUMMARY:END -->
