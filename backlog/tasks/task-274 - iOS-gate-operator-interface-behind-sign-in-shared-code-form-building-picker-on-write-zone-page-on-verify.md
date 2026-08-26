---
id: TASK-274
title: >-
  iOS: gate operator interface behind sign-in, shared code form, building picker
  on write, zone page on verify
status: In Progress
assignee: []
created_date: '2026-08-26 17:14'
updated_date: '2026-08-26 18:07'
labels: []
dependencies:
  - TASK-271
ordinal: 192000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-54. Depends on TASK-271's backend routes. Mirrors TASK-273 on iOS. NEVER touch NFCTimeSheets.entitlements, project.pbxproj, or IPHONEOS_DEPLOYMENT_TARGET -- owner-only per decision-49, unconditionally, even though this task does not appear to need them.

1) SHARED CODE FORM: extract a reusable SwiftUI view (phone field + Request SMS button + ONE code field + submit) replacing SignInView's separate smsSection+enrolmentSection, used by BOTH worker sign-in and the new operator gate. Keep .textContentType(.oneTimeCode) on the code field, active only while sentTo != nil (SMS mode); otherwise it accepts EnrolmentCode's alphabet. Preserve every existing per-outcome error message (phoneRequestMessage/otpVerifyMessage/enrolmentCodeMessage) -- consolidate the LAYOUT only.

2) OPERATOR GATE: SignInView's operatorSection currently offers two direct NavigationLinks (Write a tag / Test a tag) with no gate -- this REVERSES that: bring back a dedicated operator sign-in step (a new OperatorHomeScreen or equivalent) using the SAME shared form (role=operator, hits /auth/operator-code and NEW /auth/operator-sms/request+verify), shown before Write/Test become reachable. If an operator session already exists on disk, skip straight to Write/Test as today. Remove WriteTagScreen.swift/VerifyZoneScreen.swift's redundant inline operator-code gate once the upfront gate covers it; on session expiry mid-screen, return to the gate rather than keeping two code-entry UIs.

3) WRITE FLOW -- BUILDING PICKER: mirror TASK-273 item 3 exactly: after a successful write+report, fetch active buildings, let the operator pick one or Skip, prompt for a zone name, call POST /operator/tags/:id/resolve-zone {name, location_id?}.

4) VERIFY FLOW -- ZONE PAGE / BIND: mirror TASK-273 item 4: an unbound zone in the worklist shows the building-picker/bind UI instead of scanning; a bound zone verifies as today and then shows a zone page (name, building, verified status, paginated current-month shifts, total hours) via GET /operator/zones/:id/shifts.

5) TESTING, MOCKED: reuse the EXISTING debug-only mock mechanism (DemoHooks.swift and whatever WriteTagScreen/VerifyZoneScreen already use for simulated outcomes) rather than building a new one -- extend it to cover the new building-picker and bind/zone-page branches. No real SMS. Real: NFCTimeSheets/checks/run.sh, xcodebuild -project NFCTimeSheets.xcodeproj -scheme NFCTimeSheets -sdk iphoneos -configuration Release CODE_SIGNING_ALLOWED=NO build, and a git diff confirming entitlements/pbxproj/deployment target are byte-identical to HEAD before this task's commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 one shared SwiftUI view serves worker AND operator code entry; SignInView's old two-section layout is gone
- [ ] #2 Write a tag / Test a tag are unreachable without a valid operator session; a dedicated operator sign-in step exists again (OperatorSignInScreen-equivalent), using the shared form
- [x] #3 .textContentType(.oneTimeCode) still applies to the code field while in SMS mode
- [x] #4 after a successful write+report, a building picker (or Skip) appears and creates a zone via the new resolve-zone endpoint
- [x] #5 selecting an unbound zone in Test a tag shows the building picker/bind UI instead of starting a scan
- [x] #6 selecting a bound zone verifies as before and then shows a zone page with paginated current-month shifts and a total-hours figure
- [x] #7 debug-only mocked flows cover write-then-pick-building, write-then-skip, verify-unbound-then-bind, verify-bound-then-zone-page, no real SMS, no hardware needed
- [x] #8 NFCTimeSheets/checks/run.sh passes, the Release build (CODE_SIGNING_ALLOWED=NO) succeeds, and NFCTimeSheets.entitlements/project.pbxproj/IPHONEOS_DEPLOYMENT_TARGET are byte-identical to HEAD
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW GATE (TASK-275), 2026-08-26 — REOPENED. AC#2 does NOT hold as written. (This task carried NO implementation notes of its own; this is the first evidence recorded against it.)

WHAT IS GENUINELY CORRECT AND VERIFIED:
- One shared form. CodeSignInSection.swift declared once, called exactly twice: ContentView.swift:147 (worker) and OperatorHomeScreen.swift:44 (operator). Every TextField in the app: CodeSignInSection:67 phone, :85 THE code field, MaterialsView:96, WriteTagScreen:89 WriteGuard confirm (decision-49), WriteTagScreen:173 zone name. No second code-entry UI. AC#1 holds.
- CodeSignInSection.swift:87 '.textContentType(otpMode ? UITextContentType.oneTimeCode : nil)'. AC#3 holds.
- WriteTagScreen/VerifyZoneScreen are constructed in exactly one place each: OperatorHomeScreen.swift:51-52, inside the .signedIn branch.
- Entitlements + project.pbxproj BYTE-IDENTICAL. Blob SHAs at 56440ea (pre-session), b77523c and HEAD are all 95a3cb4f2b2bf7ea4205eb117ef8f9fcf44dc250 and 480a727855ea4c405dfdd9a15a1a1584dc7f025e. git diff over the range is empty. AC#8's diff half holds.
- NFCTimeSheets/checks/run.sh EXIT 0, 11 checks, incl. entitlement-format-check and localisation-check.

AC#2 FAILS: THE GATE IS NOT THE SESSION, IT IS A UserDefaults FLAG THAT NEVER CLEARS.
- OperatorHomeScreen.swift:30 branches on operatorSession.state.
- OperatorSession.swift:51-56 init(): state = UserDefaults integer 'operator.id' > 0 ? .signedIn : .signedOut. It NEVER reads the ts_operator cookie. decision-54 §4 says the gate is 'reading the stored cookie'. Android does exactly that (TimeSheetViewModel.kt:230); iOS does not.
- 'state = .signedOut' is assigned in exactly ONE place, OperatorSession.swift:96, inside signOut(). Grep: signOut() is called from NOWHERE in the UI. OperatorHomeScreen has no sign-out control. OperatorAPI deliberately never posts .sessionRejected (correct per decision-49), so a 401 never reaches state either.
- Therefore the operator sign-in form at OperatorHomeScreen.swift:44 is reachable EXACTLY ONCE PER INSTALL. After the first successful sign-in the gate is permanently .signedIn regardless of whether ts_operator still exists.
- The trigger is one tap away and pre-existing: ContentView.swift:680 'Sign out' -> Auth.swift:176-181 clearLocalSession() deletes EVERY cookie for API.base, including ts_operator, and does not touch 'operator.id'. Server-side expiry/revocation does the same thing.
- Resulting state: OperatorHomeScreen still offers Write a tag / Test a tag, every operator call 401s, the inline code fields that used to rescue this were removed by this commit, and '.onChange(of: operatorSession.operatorInfo == nil)' (WriteTagScreen:64, VerifyZoneScreen:66) can never fire because nothing sets .signedOut. No in-app recovery short of reinstalling.
Filed as TASK-276.

SECOND GAP — 4 RELEASE-VISIBLE STRINGS SHIP UNTRANSLATED, against AGENTS.md's no-follow-up-commit i18n rule:
Not in Localizable.xcstrings at all, so a German-default app renders the English key.
  ContentView.swift:174           'Write or test tags'
  ContentView.swift:674           'Write or test tags'
  OperatorHomeScreen.swift:35     'Sign in as an operator to write and test tags. This never opens a shift.'
  OperatorHomeScreen.swift:59     .navigationTitle('Operator')
Verified by extracting every Text/NavigationLink/Button/navigationTitle literal at HEAD and at c7337fd~1 and diffing the missing sets — all four are NEW in c7337fd; the only pre-existing miss is DemoHooks.swift:106 (demo build). Two more, DEBUG-only and therefore low: VerifyZoneScreen:98-99 and WriteTagScreen:131-132.
localisation-check.swift passes anyway (222 keys, all German) and cannot catch this — its own header says so: 'a new Text(...) with no catalogue entry renders its English literal'. The other ~37 new keys DID get German, so this is four misses, not a missing pass. Filed as TASK-278.

THIRD, PRE-EXISTING, NOT FROM THIS COMMIT: decision-49 §4 ('OperatorAPI gets its own URLSession with httpShouldSetCookies=false, its own store, token in the Keychain — two jars, no request that carries both') is not implemented. OperatorAPI.swift:20-22 and :65 use URLSession.shared and HTTPCookieStorage.shared, and say so. Present at 56440ea, so not this run's doing — but it is what makes the AC#2 failure above reachable. Filed as TASK-279.
<!-- SECTION:NOTES:END -->
