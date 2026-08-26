---
id: TASK-274
title: >-
  iOS: gate operator interface behind sign-in, shared code form, building picker
  on write, zone page on verify
status: Done
assignee: []
created_date: '2026-08-26 17:14'
updated_date: '2026-08-26 17:42'
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
- [x] #2 Write a tag / Test a tag are unreachable without a valid operator session; a dedicated operator sign-in step exists again (OperatorSignInScreen-equivalent), using the shared form
- [x] #3 .textContentType(.oneTimeCode) still applies to the code field while in SMS mode
- [x] #4 after a successful write+report, a building picker (or Skip) appears and creates a zone via the new resolve-zone endpoint
- [x] #5 selecting an unbound zone in Test a tag shows the building picker/bind UI instead of starting a scan
- [x] #6 selecting a bound zone verifies as before and then shows a zone page with paginated current-month shifts and a total-hours figure
- [x] #7 debug-only mocked flows cover write-then-pick-building, write-then-skip, verify-unbound-then-bind, verify-bound-then-zone-page, no real SMS, no hardware needed
- [x] #8 NFCTimeSheets/checks/run.sh passes, the Release build (CODE_SIGNING_ALLOWED=NO) succeeds, and NFCTimeSheets.entitlements/project.pbxproj/IPHONEOS_DEPLOYMENT_TARGET are byte-identical to HEAD
<!-- AC:END -->
