---
id: TASK-282
title: >-
  Android: Test a tag accepts any scanned card; add Reassign Building on a bound
  zone (decision-55)
status: Done
assignee: []
created_date: '2026-08-26 20:59'
updated_date: '2026-08-26 21:25'
labels:
  - android
  - operator
  - decision-55
dependencies:
  - TASK-281
priority: high
ordinal: 200000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-55, depends on TASK-281 (backend routes must exist first). Android's Test a tag
screen (VerifyZoneActivity.kt) currently only reaches a zone by picking one from the
worklist first (GET /operator/zones) -- there is no scan-first path at all.

1. Scan-first entry point: the operator scans a card with no prior selection, the app calls
   GET /operator/tags/:id (parsing the tag's UUID the same way it already does everywhere
   else, TagLink), and branches on `kind`:
   - "zone" with a bound zone: call the existing verify endpoint
     (POST /operator/zones/:id/verify {place_uuid: same id}) then show the SAME zone-detail
     page decision-54/TASK-274 already built (worker shifts, total hours, paginated).
   - "zone" with an unbound zone: show the SAME building-picker+bind UI TASK-274 already
     built for this case -- do not build a second one.
   - "building": a plain informational message ("this is a building card, not a zone").
   - "retired": a plain informational message that this card belonged to a zone that has
     since been reassigned/deactivated.
   - "tag_reported": a plain informational message that this card is known but nobody has
     turned it into a zone yet. No action offered from this screen.
   - "unknown": a plain informational message that this card is not one of ours.
   Keep the EXISTING worklist-first path working unchanged -- this is an ADDED entry point,
   not a replacement (decision-55 section 2).

2. Reassign building, on a BOUND zone's detail page: a new action that runs the SAME
   mint-id -> write-tag -> report-tag sequence Write a tag already has (reuse it, do not
   duplicate the NFC write code), then calls POST /operator/zones/:oldId/reassign-building
   {new_tag_id, location_id}. On success, land on the NEW zone's detail page (fresh,
   unverified, 0 shifts). Building picker for the target reuses the same component the
   unbound-zone bind flow already uses.

Reuse the existing debug-only simulation mechanism (writeSimulations/verifyTapSimulations)
to cover all of this without real hardware -- add scenarios, do not invent a second
mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 scanning an arbitrary card with no prior worklist selection reaches all 6 branches (zone bound, zone unbound, building, retired, tag_reported, unknown) with a distinct message or screen per branch, proven via the debug mock mechanism
- [x] #2 scanning a bound zone's card auto-verifies it (calls the existing verify endpoint) and lands on the same zone-detail page the worklist-first path already uses -- no second UI built
- [x] #3 the existing worklist-first Test a tag path (GET /operator/zones then pick, then verify) still works unchanged
- [x] #4 Reassign Building is offered only on a BOUND zone's detail page, runs mint-write-report using the SAME code Write a tag uses (not a duplicate), and calls reassign-building with the new tag id and picked building
- [x] #5 on a successful reassign, the app lands on the new zone's fresh detail page (unverified, 0 shifts); the OLD zone is never shown as still live anywhere in the UI after this
- [x] #6 reassign-building's 404/409/422 failures each render a specific translated sentence, not a raw error code (German default per decision-8, English kept)
- [x] #7 android/checks/run.sh full suite passes, including gradlew compileDebugKotlin/assembleDebug
- [x] #8 git diff shows only android/ files touched; entitlements/pbxproj not applicable but confirm nothing outside android/ changed; nothing pushed
<!-- AC:END -->





## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Committed 2fdb036 (android/ only, 8 files, +933/-11; git diff --stat confirms nothing outside android/ changed; not pushed).

AC#1 six branches: nfc/VerifySimulation.kt (debug) classifyTapSimulations() gives one button per branch — bound zone, unbound zone, building, retired, tag_reported, unknown — plus an unreadable card; simulatedClassification() answers GET /operator/tags/:id for those ids only and is constantly null in src/release/. Wire.tagClassification decoding for all five kinds + the two degrade cases is asserted in checks/core-check.kt (core-check: OK).
AC#2 a bound zone calls the UNCHANGED Api.verifyZone through the SAME handleRead() the worklist path uses and lands on the SAME ZonePage composable — no second screen; unbound falls into the existing BindBody/BuildingPicker.
AC#3 selectZone()/handleRead() are unchanged for the worklist-first path; the scan-first path is a new branch in onTag() gated on selectedZone == null.
AC#4 Reassign Building renders only inside the bound branch (ReassignSection is called after ZonePage in the isBound path) and writes via app.tagWriter.write + Api.reportTag — the write screen's own writer and report call, not a copy — then Api.reassignZoneBuilding(zoneId,newTagId,locationId).
AC#5 on success the retired_zone_id row is filtered OUT of the worklist and the new zone (verified_at null, no shifts) is selected; runReassignSimulation covers it in debug.
AC#6 reassignFailureText() maps unknown_zone / zone_unbound / unknown_reported_tag / already_resolved / duplicate_zone_name / id_in_use / unknown_location to their own strings; DE + EN added in the same commit, key-set parity verified by diffing the name= sets of values/ and values-en/ (empty diff).
AC#7 android/checks/run.sh full suite green: core-check: OK, known-tags-check: OK, tag-writer-check: OK, manifest-check: OK, verify-no-shift-check: OK. gradlew compileDebugKotlin, assembleDebug and compileReleaseKotlin all BUILD SUCCESSFUL.
AC#8 git diff --stat lists only android/ paths. Also ran node ops/check-branding.mjs: 'check-branding: OK', no TODO lines in its output.

NOT DONE / caveats: nothing was run on a physical device — all six branches and the reassign write are proven through the debug simulator and the JVM checks only; a real NFC write during a reassignment is untested on hardware. release-artefact.sh was not run (needs a signed release APK). Server routes were assumed live as landed by TASK-281; no request was made against a running server.
<!-- SECTION:NOTES:END -->
