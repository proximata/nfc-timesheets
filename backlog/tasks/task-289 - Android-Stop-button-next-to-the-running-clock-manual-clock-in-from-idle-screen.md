---
id: TASK-289
title: >-
  Android: Stop button next to the running clock + manual clock-in from idle
  screen
status: Done
assignee: []
created_date: '2026-08-27 09:42'
updated_date: '2026-08-27 11:13'
labels:
  - android
  - decision-56
dependencies:
  - TASK-287
priority: high
ordinal: 207000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 idle screen (no shift running) has a clearly secondary 'start without a tag' action opening a building picker built from the already-cached roster; confirmation required before it calls POST /shifts/open with manual=true
- [x] #2 running-shift screen has a Stop button next to the ticking clock; confirmation dialog names the building and says this is flagged for office review; calls POST /shifts/close with manual=true, no location
- [x] #3 server 422/409 responses on the manual-open path (unbound zone, unverified place, already open elsewhere, wrong building) are shown with the SAME copy the tap path already uses, not a new generic error
- [x] #4 TimeSheetApp.kt's 'there must not be one' comment is updated to point at decision-56 rather than deleted, explaining why the two new paths are safe (flagged, not silent)
- [x] #5 the existing debug simulation mechanism covers both new flows (manual open success+refusal, manual close) with zero simulation code reachable in a release build
- [x] #6 android/checks/run.sh passes clean, DE/EN strings.xml key-set parity holds
- [x] #7 confirm only android/ files touched (git diff --stat)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-291 gate 2026-08-27: android/checks/run.sh exit 0 (core-check, known-tags, tag-writer, manifest, verify-no-shift all OK). core-check.kt's PRE-EXISTING pinned open/close bodies still pass, which is the real proof of AC-level 'tap bytes unchanged' - manual is dropped by listOfNotNull when false. DE/EN strings.xml parity checked by hand (no gate exists): 329 keys each, diff empty. AC3 confirmed structurally - both dialogs render stringResource(stringIdFor(failure.messageKey)), the same path TimeSheetApp.kt:621/1601 uses for the tap path, and ApiFailure.kt maps zone_unverified/shift_already_open/unknown_location to their own keys. AC7 confirmed: afb16e8 touches android/ only. GENUINELY DONE.
CAVEAT on AC5: android/checks/release-artefact.sh needs a built APK and was NOT run, so 'zero simulation code in release' rests on the src/release/ ManualSimulation.kt stub (read: both list functions return emptyList, nothing constructs a ManualSimulation) rather than on a dex grep. iOS's equivalent WAS proven against the binary this run. Run release-artefact.sh at the next signed build.
<!-- SECTION:NOTES:END -->
