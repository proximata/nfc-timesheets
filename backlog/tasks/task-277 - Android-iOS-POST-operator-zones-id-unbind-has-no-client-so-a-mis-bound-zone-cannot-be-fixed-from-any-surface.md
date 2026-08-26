---
id: TASK-277
title: >-
  Android + iOS: POST /operator/zones/:id/unbind has no client, so a mis-bound
  zone cannot be fixed from any surface
status: Done
assignee: []
created_date: '2026-08-26 18:08'
updated_date: '2026-08-26 18:30'
labels:
  - android
  - ios
  - decision-54
dependencies:
  - TASK-271
ordinal: 195000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-275 (review gate). Grep for 'unbind' returns ZERO matches under NFCTimeSheets/, android/ and web/. The route exists and is fully tested server-side (routes/operator.js:356-377, check-api.js:6588/6611) and nothing calls it.

WHY IT MATTERS, precisely: decision-54 §3 says bind REFUSES a zone that already has a building (409 already_bound) because 'rebinding is unbind-then-bind, never a silent move'. decision-54 §2/§3 also removed the admin panel's ability to create or bind a zone at all. So an operator who binds a zone to the wrong building has NO path back — not from the phone, not from the desk. Only a hand-rolled HTTP call carrying a ts_operator cookie.

NOT A REGRESSION: this was in neither TASK-273's nor TASK-274's acceptance criteria, and both are otherwise honest. It is a hole in the decision's own rollout that nobody's ACs covered.

WHAT TO DO: on the zone page for a BOUND zone (the screen decision-54 §7 specifies), add an unbind action behind a confirmation that names the building being removed. It must surface 409 zone_has_shifts as a sentence in both languages — 'somebody has clocked in at this door, so it stays with this building' — never a code, never a generic failure. Unbind does NOT clear verified_at (server-side rule, operator.js:349-351); do not reimplement that client-side.

MUST NOT REGRESS: no new server endpoint (decision-54 ships all of them); no unbind affordance in the admin panel (decision-54 §3 puts it in the operator's hand); zero change to the verify or bind flows.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 a bound zone's operator zone page offers unbind, behind a confirmation naming the building
- [x] #2 409 zone_has_shifts renders as a sentence, de and en, on both platforms
- [x] #3 no new server route and no admin-panel unbind affordance
- [x] #4 debug-only mocked flows cover unbind-ok and unbind-refused on both platforms
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED 2026-08-26. iOS 670a862, Android 997a824. AC#1: bound zone only - VerifyZoneScreen.unbindRows guards on zone.isBound behind a .confirmationDialog naming zone.locationName; VerifyZoneActivity.UnbindAction is rendered inside the bound branch, AlertDialog body verify_unbind_confirm_body takes %1$s = building name. Both say nothing is deleted. AC#2: 409 zone_has_shifts is its own state on both platforms (UnbindState.hasShifts / UnbindStep.HasShifts), never folded into a code - iOS 'Somebody has already clocked in at this door, so it stays with this building.' with the de entry in Localizable.xcstrings; Android verify_unbind_has_shifts in BOTH values-en and values/ ('Hier wurde bereits eingestempelt, deshalb bleibt diese Zone bei diesem Objekt.'). AC#3: no server file in either commit (git show --stat: NFCTimeSheets/ and android/ only); grep 'unbind' under web/ still returns zero. AC#4: iOS OperatorMockFlow.unbindBoundZone / .unbindZoneWithShifts behind #if DEBUG; Android a third debug fixture zone ...0000c3 whose runUnbindSimulation throws ApiFailure(409, zone_has_shifts), release stub returns the zone unchanged. verified_at is carried through untouched on both platforms and in both fixtures - the server's rule is not reimplemented. android/checks/run.sh OK; compileDebugKotlin + assembleDebug BUILD SUCCESSFUL; NFCTimeSheets/checks/run.sh OK; iOS Release build SUCCEEDED. gradlew lint still red, entirely pre-existing (117 NewApi java.time errors in untouched files; the 13 naming VerifyZoneActivity.kt are the pre-existing date-formatting block at :484 and :850-868, none in the unbind code).
<!-- SECTION:NOTES:END -->
