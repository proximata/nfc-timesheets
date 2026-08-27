---
id: TASK-286
title: >-
  Android reassign picker offers the zones CURRENT building - burns a written
  card for a misleading 409 duplicate_zone_name (iOS already guards it)
status: To Do
assignee: []
created_date: '2026-08-27 06:48'
labels:
  - android
  - operator
  - decision-55
dependencies: []
priority: low
ordinal: 204000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PRE-EXISTING IN THE decision-55 ROLLOUT, found by TASK-284 (review gate). A PLATFORM DIVERGENCE, and Android is the side that is wrong.

iOS guards it - NFCTimeSheets/NFCTimeSheets/VerifyZoneScreen.swift:434:
    .disabled(reassignLocationId == nil || reassignLocationId == zone.locationId)
with the comment "The zones CURRENT building is not a move. Disabled rather than hidden".

Android does not - android/app/src/main/kotlin/io/github/qwadratic/nfctimesheets/nfc/VerifyZoneActivity.kt:546:
    enabled = reassignBuilding != null
GET /operator/locations returns every ACTIVE building including the one this zone already sits in, so the operator can pick it.

WHAT THEN HAPPENS, in this order, all of it real work:
  1 operator picks the building the zone is already in
  2 the phone WRITES a fresh uuid onto a physical card (VerifyZoneActivity.kt:1199, app.tagWriter.write)
  3 the phone REPORTS it (POST /operator/tags) - the id is now a permanent reported_tags row
  4 POST /operator/zones/:id/reassign-building answers 409 duplicate_zone_name, because the mint
    collides with the STILL-ACTIVE old zone on zones_one_live_name_idx (location_id, lower(btrim(name)))
  5 the operator reads R.string.verify_reassign_duplicate_name - "that building already has a zone
    with this name" - about a zone that IS the one on screen

CONFIRMED at the SQL level, the exact statement from server/routes/operator.js:558-576 with the target
building equal to the old zones own:
    ERROR:  duplicate key value violates unique constraint "zones_one_live_name_idx"
    DETAIL: Key (location_id, lower(btrim(name)))=(1111...1111, stiege 3) already exists.
Nothing partially applies (old zone still active and bound, report still unclaimed - the statement
aborts atomically), so this costs a card and a confusing sentence, not integrity.

FIX: mirror iOS. Disable the submit when the picked building is the zones current locationId, rather
than hiding the row - an operator scanning for the building they meant needs to see the one they are
leaving. Do NOT fix it server-side as a new named refusal: the server refusal already exists and is
correct, and reaching it at all means a card was already written.

MUST NOT REGRESS: the picker still lists every active building (a disabled current entry, not a
filtered-out one); Reassign Building stays offered only under a BOUND zone (VerifyZoneActivity.kt:403
returns before it for unbound zones).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Android disables the reassign submit when the picked building equals the zones current locationId, matching VerifyZoneScreen.swift:434
- [ ] #2 the current building is still VISIBLE in the picker, disabled and not filtered out
- [ ] #3 no card is written and no tag is reported on that path - the guard sits before ReassignStep.AwaitingCard, never after the write
- [ ] #4 debug simulator covers picking the current building and shows the button stays disabled
- [ ] #5 android/checks/run.sh green and gradlew compileDebugKotlin/compileReleaseKotlin succeed; DE + EN key-set parity unchanged
<!-- AC:END -->
