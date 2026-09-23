---
id: TASK-363
title: Android Blue Hour redesign after worker UI feedback
status: Done
assignee:
  - '@codex'
created_date: '2026-09-23 19:10'
updated_date: '2026-09-23 19:55'
labels: []
dependencies: []
priority: high
ordinal: 282000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the rejected TASK-360 worker presentation with a new time-first design, staged server-confirmed animation, and compact honest delivery status. Preserve accounting, NFC, manual actions, operator entry and both locales.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Worker screens use the selected coherent Blue Hour design with proportional time typography and no white timer slab
- [x] #2 Confirmation motion is finite, ACK-only, reduced-motion safe and never gates actions or writes
- [x] #3 Queued and blocked hours stay visible in compact rows with accurate details and no false automatic-delivery promise
- [x] #4 German and English, real emulator actions, large fonts and decision review are verified with screenshots and motion evidence
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Compare concepts with designer. 2. Rebuild worker presentation and delivery detail. 3. Implement state-safe confirmation. 4. Drive emulator and critique captures. 5. Run checks, record limits and commit locally.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Compared Blue Hour, Paper Route and Dial with a Sol designer; selected Blue Hour. Rebuilt the running time field and recent completion receipt, added finite ACK-only ring/check motion with persisted cosmetic consumption, replaced the pending wall of text with separate waiting/blocked rows and detail sheet, and retained all manual/NFC/auth/timeout paths. Independent all-decision source review passed after restoring the required under-clock state label and making receipt lifetime explicitly Continue-driven. Emulator feature verification is in progress. Build passes; 19 changed DE/EN resource keys and format arguments match. pnpm verify still reports the four pre-existing Windows path assertions; full Android core check rerun is underway after updating the delivery-component source assertions.

Final visual critic accepts running, confirmation, revised compact idle schedule and flat materials composer. Final feature verifier drove actual local API/Postgres tag open and manual close, cancellation, materials submit with persisted server row, both locales/themes, 200 percent text, offline queue/detail/reconnect, reduced motion, restart/tab revisit and five-version-tap operator entry. Final APK installed. Dedicated blocked CLOSED-row rejection check is the last outstanding evidence. Android core rerun is back to exactly four known baseline failures; all other exercised JVM groups pass.

Final blocked-only CLOSED-row rejection verified through actual local API: compact row and accurate no-retry details persist after dismiss and restart. Final timestamp copy verified on installed APK. 23 changed DE/EN keys pass parity. All server test shifts closed; deliberately rejected local test row preserved. Final screenshots, opening/closing recordings, matrix and review reports are in captures/company-workspaces/android-reset/.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Rebuilt the Android worker presentation around proportional time, compact schedule and delivery rows, and a 900 ms ACK-only ring/check confirmation. Three concepts compared; independent visual critic and all-decision code review passed. Real emulator/local API/Postgres scenarios cover open, cancel, manual close, offline retry, blocked rejection, materials, locales/themes, 200 percent text and reduced motion. Debug build and branding pass. Android core and pnpm verify each retain four documented baseline Windows/source assertion failures; pnpm verify stopped at check. Physical NFC and Play delivery were not tested. No push or deployment.
<!-- SECTION:FINAL_SUMMARY:END -->
