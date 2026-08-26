---
id: TASK-273
title: >-
  Android: gate operator interface behind sign-in, shared code form, building
  picker on write, zone page on verify
status: Done
assignee: []
created_date: '2026-08-26 17:13'
updated_date: '2026-08-26 17:52'
labels: []
dependencies:
  - TASK-271
ordinal: 191000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-54. Depends on TASK-271's backend routes.

1) SHARED CODE FORM: extract a reusable composable (phone field + Request SMS button + ONE code field + submit) used by BOTH worker SignInScreen and a NEW operator sign-in gate. The code field auto-detects shape: while sentTo != null it is 6-digit-only (SMS OTP); otherwise it accepts the 8-char Crockford alphabet (enrolment code). Preserve ALL existing per-field error message mapping (unknown_phone, invalid_phone, too_many_attempts, sms_not_configured, invalid_code) -- only the LAYOUT consolidates, not the error copy logic. Add SMS autofill: Compose ContentType.SmsOtpCode if the pinned Compose UI version has it stable, else the SMS User Consent API (play-services-auth, one BroadcastReceiver, no manifest permission, no app-hash coordination) as fallback -- pick whichever is actually available, note the choice in the PR/commit message.

2) OPERATOR GATE: replace SignInScreen's two direct 'Write a tag'/'Test a tag' buttons with one operator entry point. If !operatorReady, show the shared code form (role=operator, hits /auth/operator-code and NEW /auth/operator-sms/request+verify) BEFORE anything else. If operatorReady already (stored ts_operator cookie, no network), go straight to Write/Test as today. Remove the now-redundant inline operator-code fields from WriteTagActivity.kt/VerifyZoneActivity.kt; if a session expires mid-screen, bounce back to the gate rather than duplicating the code field.

3) WRITE FLOW -- BUILDING PICKER: after a successful write + report (ReportState.Sent), add a new step: fetch GET /operator/locations, let the operator pick a building or Skip, prompt for a zone name, call POST /operator/tags/:id/resolve-zone {name, location_id?}. Show the result (zone created, bound or unbound).

4) VERIFY FLOW -- ZONE PAGE / BIND: in VerifyZoneActivity's zone worklist (now including unbound zones from the updated GET /operator/zones), selecting a zone with locationId == null shows the SAME building-picker+skip UI (calls POST /operator/zones/:id/bind), never starts reader mode until bound. Selecting an already-bound zone works as today (scan, verify) and afterwards additionally fetches GET /operator/zones/:id/shifts?month=&page= and shows a zone page: name, building, verified status, paginated current-month shifts (worker, start, end, duration), total hours for the month.

5) TESTING, MOCKED: extend the EXISTING debug-only simulation mechanism (writeSimulations()/runSimulation() in src/debug, verifyTapSimulations() likewise) to cover the new post-write building-picker step and the new post-scan bind-or-zone-page branch. Do not build a new test harness; reuse this one. Do not hit real SMS -- mock the request/verify calls the same way the rest of this debug harness mocks network. Real: android/checks/run.sh, gradlew compileDebugKotlin/assembleDebug/lint, and the de/en strings.xml parity check for every new string.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 one shared composable serves worker AND operator code entry; no second, differently-laid-out code field exists anywhere in the app
- [x] #2 Write a tag / Test a tag are unreachable without a valid operator session; entering one via the shared form on this screen establishes operatorReady exactly as the old inline fields did
- [x] #3 SMS autofill is wired for the shared code field on Android (ContentType.SmsOtpCode or SMS User Consent API, whichever was chosen)
- [x] #4 after a successful write+report, a building picker (or Skip) appears and creates a zone via the new resolve-zone endpoint, bound or unbound accordingly
- [x] #5 selecting an unbound zone in Test a tag shows the building picker/bind UI instead of starting a scan
- [x] #6 selecting a bound zone still verifies as before AND afterwards shows a zone page with paginated current-month shifts and a total-hours figure
- [x] #7 debug-only simulations cover: write-then-pick-building, write-then-skip, verify-unbound-then-bind, verify-bound-then-zone-page -- all mocked, no real SMS, no real NFC hardware needed to exercise them
- [x] #8 android/checks/run.sh passes, gradlew compileDebugKotlin and assembleDebug succeed, de/en strings.xml stay in parity for every new string
- [x] #9 no change to AndroidManifest permissions beyond what SMS autofill choice actually requires
<!-- AC:END -->
