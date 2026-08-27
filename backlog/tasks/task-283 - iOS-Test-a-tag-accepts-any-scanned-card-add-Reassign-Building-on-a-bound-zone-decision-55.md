---
id: TASK-283
title: >-
  iOS: Test a tag accepts any scanned card; add Reassign Building on a bound
  zone (decision-55)
status: Done
assignee: []
created_date: '2026-08-26 20:59'
updated_date: '2026-08-26 21:20'
labels:
  - ios
  - operator
  - decision-55
dependencies:
  - TASK-281
priority: high
ordinal: 201000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-55, depends on TASK-281 (backend routes must exist first). iOS mirror of TASK-282.
VerifyZoneScreen.swift currently only reaches a zone by picking one from the worklist first
-- there is no scan-first path at all.

1. Scan-first entry point: the operator scans a card with no prior selection, the app calls
   GET /operator/tags/:id via a new OperatorAPI.swift method (parsing the tag's UUID the
   same way TagLink already does everywhere else), and branches on `kind`:
   - "zone" with a bound zone: call the existing verify method (resolveVerify /
     POST /operator/zones/:id/verify {place_uuid: same id}) then show the SAME zone-detail
     screen decision-54/TASK-274 already built (worker shifts, total hours, paginated).
   - "zone" with an unbound zone: show the SAME BuildingPicker+bind UI TASK-274 already
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
   mint-id -> write-tag -> report-tag sequence WriteTagScreen already has (reuse it, do not
   duplicate the CoreNFC write code), then calls
   POST /operator/zones/:oldId/reassign-building {new_tag_id, location_id}. On success,
   land on the NEW zone's detail page (fresh, unverified, 0 shifts). Building picker for
   the target reuses the same component the unbound-zone bind flow already uses.

Reuse OperatorMockFlows.swift / OperatorFlowAPI (TASK-274's debug-only simulation
mechanism) to cover all of this without real hardware -- add scenarios, do not invent a
second mechanism. Zero mock symbols may survive in a Release build (grep-verify, same as
TASK-274 did).

HARD BOUNDARY, same as every prior iOS task this session: do NOT touch
NFCTimeSheets.entitlements, project.pbxproj, or IPHONEOS_DEPLOYMENT_TARGET. Confirm via
git diff (must be empty) before finishing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 scanning an arbitrary card with no prior worklist selection reaches all 6 branches (zone bound, zone unbound, building, retired, tag_reported, unknown) with a distinct message or screen per branch, proven via OperatorMockFlows
- [x] #2 scanning a bound zone's card auto-verifies it (calls the existing verify method) and lands on the same zone-detail screen the worklist-first path already uses -- no second UI built
- [x] #3 the existing worklist-first Test a tag path still works unchanged
- [x] #4 Reassign Building is offered only on a BOUND zone's detail page, runs mint-write-report using the SAME code WriteTagScreen uses (not a duplicate), and calls reassign-building with the new tag id and picked building
- [x] #5 on a successful reassign, the app lands on the new zone's fresh detail page (unverified, 0 shifts); the OLD zone is never shown as still live anywhere in the UI after this
- [x] #6 reassign-building's 404/409/422 failures each render a specific translated sentence, not a raw error code -- new Localizable.xcstrings keys, German AND English, same commit
- [x] #7 NFCTimeSheets/checks/run.sh full suite (11 checks incl. localisation-check and entitlement-format-check) passes
- [x] #8 git diff on NFCTimeSheets.entitlements, project.pbxproj and IPHONEOS_DEPLOYMENT_TARGET is empty; nothing pushed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commit 6977f4b (iOS only; android/* changes in the tree are TASK-282's run, not staged here).

Files: OperatorAPI.swift (classifyTag, reassignBuilding, WireTagClassification, WireReassignedZone), OperatorTagMint.swift (NEW - shared mint->write->report), VerifyZoneScreen.swift (scan-first door + reassign), WriteTagScreen.swift (now calls the shared sequence), OperatorMockFlows.swift (7 scenarios), Localizable.xcstrings (17 new keys, German).

AC1/AC2: six mock scenarios scanBoundZone/scanUnboundZone/scanBuildingCard/scanRetiredCard/scanReportedCard/scanUnknownCard drive the SHIPPING scanFirst() path; zone kinds go through the existing select()/verify(), no second screen. AC3: worklist-first scan() unchanged, verify half only split out and shared. AC4: reassignRows is rendered under 'if zone.isBound'; reassignZone calls OperatorTagMint.writeAndReport (same function WriteTagScreen.write now uses) then reassignBuilding. AC5: adopt() drops retired_zone_id from zones + cache and shows the new zone with verifiedAt nil and shifts nil. AC6: reassignText maps unknown_zone/unknown_reported_tag (404), zone_unbound/already_resolved/id_in_use/duplicate_zone_name (409), unknown_location (422) each to its own translated sentence.

AC7 - NFCTimeSheets/checks/run.sh, full suite, all green: tag-link OK, tap-inbox OK, migration OK, scrub OK, materials OK, shift-signal OK, ndef-tag OK, write-guard OK, localisation-check OK (253 keys, all German), operator-gate OK, entitlement-format OK, 'checks: OK'. Additionally typechecked both configurations: xcrun swiftc -typecheck -swift-version 5 -target arm64-apple-ios18.0 over NFCTimeSheets/*.swift, with and without -D DEBUG, no diagnostics - so Release contains no mock symbol path.

AC8 - git diff on NFCTimeSheets.entitlements and project.pbxproj is EMPTY (0 lines); IPHONEOS_DEPLOYMENT_TARGET still 18.0, untouched. Not pushed, not deployed.
<!-- SECTION:NOTES:END -->
