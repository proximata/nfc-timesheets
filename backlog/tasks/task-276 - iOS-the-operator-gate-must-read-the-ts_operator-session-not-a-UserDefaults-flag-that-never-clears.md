---
id: TASK-276
title: >-
  iOS: the operator gate must read the ts_operator session, not a UserDefaults
  flag that never clears
status: Done
assignee: []
created_date: '2026-08-26 18:07'
updated_date: '2026-08-26 18:30'
labels:
  - ios
  - decision-54
  - bug
dependencies:
  - TASK-274
ordinal: 194000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-275 (review gate) in commit c7337fd. decision-54 §4 says the operator interface shows the two actions 'once an operator session already exists on disk (unchanged: reading the stored cookie, no network call)'. Android does exactly that. iOS does not.

MEASURED, not remembered:
- OperatorHomeScreen.swift:30 branches on OperatorSession.state.
- OperatorSession.swift:51-56 init() sets state from UserDefaults integer 'operator.id' > 0. The ts_operator cookie is never consulted.
- 'state = .signedOut' is assigned in exactly one place, OperatorSession.swift:96, inside signOut(). signOut() has zero callers in any view (grep). OperatorHomeScreen offers no sign-out.
- OperatorAPI.swift never posts .sessionRejected (correct, decision-49 §4), so a 401 cannot reach state either.
- ContentView.swift:680 'Sign out' -> Auth.swift:176-181 deletes EVERY cookie for API.base including ts_operator, and leaves 'operator.id' behind.

CONSEQUENCE: after the first successful operator sign-in, the gate is permanently .signedIn on that install. A worker sign-out, a session revocation or the 90-day TTL leaves the two actions on screen with a dead cookie, every call 401s, and the inline code fields that used to rescue this were deleted by c7337fd. No in-app recovery.

WHAT TO DO (smallest correct fix, do NOT invent a session-probe endpoint):
1. Derive readiness from the ts_operator cookie the same way Android does, re-read when OperatorHomeScreen appears. Today that means HTTPCookieStorage.shared.cookies(for: API.base) filtered by name == 'ts_operator'. If TASK-279 lands first, read the private store instead.
2. Keep the UserDefaults id/name purely as the display echo of WHO is signed in, never as the gate.
3. Map a 401 from any operator call to state = .signedOut(reason:) so WriteTagScreen:64 / VerifyZoneScreen:66's existing onChange dismiss actually fires.

ACCEPTANCE EVIDENCE: deleting the ts_operator cookie (or signing the worker out) and reopening the operator entry point must show the shared code form again, with no reinstall. Add the pin to NFCTimeSheets/checks/ — iOS has no equivalent of android/checks/core-check.kt's operator-gate assertions, which is why this got through.

MUST NOT REGRESS: no network call may be required to decide what the gate shows (a basement with no signal must still let a signed-in operator through). Never touch NFCTimeSheets.entitlements or project.pbxproj (decision-49).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 OperatorHomeScreen's signed-in branch is reachable only while a ts_operator cookie exists
- [x] #2 deleting the cookie or signing the worker out returns the operator to the shared code form with no reinstall
- [x] #3 a 401 from any operator call drives OperatorSession to .signedOut so the existing dismiss-on-session-loss fires
- [x] #4 a check under NFCTimeSheets/checks/ pins the gate, with its RED case seeded
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED 2026-08-26, commit 670a862. AC#1: OperatorSession.refresh() guards on hasSessionCookie, which filters HTTPCookieStorage.shared.cookies(for: API.base) by name == ts_operator; the UserDefaults id/name are read only AFTER that guard, as the display echo. AC#2: no cookie -> clearCache() + .signedOut, and OperatorHomeScreen calls refresh() in .onAppear, so a worker sign-out (Auth.swift clears every cookie for API.base) returns the operator to the shared code form on the next appearance, no reinstall. AC#3: sendOperator posts .operatorSessionRejected on any 401 (never the worker's .sessionRejected - decision-49 §4), OperatorSession observes it and sets .signedOut(reason:), so WriteTagScreen:64 / VerifyZoneScreen:66's onChange dismiss can now fire. AC#4: NFCTimeSheets/checks/operator-gate-check.swift, wired into checks/run.sh; RED case run by me - removing the .onAppear refresh line makes it FAIL on 'OperatorHomeScreen re-derives the gate on every appearance', restoring it returns 'operator-gate-check: OK'. MUST-NOT-REGRESS: refresh() is synchronous and awaits nothing - no network call decides what the gate shows. run.sh OK (12 checks). xcodebuild -sdk iphoneos -configuration Release CODE_SIGNING_ALLOWED=NO ** BUILD SUCCEEDED **. entitlements/pbxproj byte-identical to HEAD (empty git diff).
<!-- SECTION:NOTES:END -->
