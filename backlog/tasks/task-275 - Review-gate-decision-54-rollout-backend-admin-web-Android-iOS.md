---
id: TASK-275
title: 'Review gate: decision-54 rollout (backend + admin web + Android + iOS)'
status: Done
assignee: []
created_date: '2026-08-26 17:14'
updated_date: '2026-08-26 18:30'
labels: []
dependencies:
  - TASK-271
  - TASK-272
  - TASK-273
  - TASK-274
ordinal: 193000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Workflow Review Gate per AGENTS.md, run AFTER TASK-271/272/273/274 all complete. Read decision-54 and every decision it amends (43, 44, 45, 47, 48, 51) plus decisions 6/42 (zone-is-not-a-costing-unit). Read the actual diffs. Verify: no admin path can create a zone; no code contradicts decision-44's untouched adopted-serial flow; the operator gate is real (unreachable without a session) on both platforms; the shared code form exists on both platforms with no leftover second code-entry UI; zone-shifts data exposed to operators carries no rate/money/client name; unbind's shift-history refusal is DB-enforced not app-logic-enforced. Run and quote: server/check-api.js, ops/check-branding.mjs, NFCTimeSheets/checks/run.sh, android/checks/run.sh, pnpm verify (web). Confirm entitlements/pbxproj untouched via git diff. Confirm nothing was pushed or deployed. Update TASK-271..274's backlog status with real evidence (never mark Done without a passing check or command output), and report any gaps found rather than closing a task that only partly landed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 decision-54 and its amended decisions are read and no code contradicts them
- [x] #2 decision-44's adopted-hardware tag-serial flow is confirmed untouched
- [x] #3 operator interface is confirmed unreachable without sign-in on both platforms, by reading the actual gate code
- [x] #4 zone-shifts payload confirmed to carry no rate/money/client fields
- [x] #5 server/check-api.js, ops/check-branding.mjs, NFCTimeSheets/checks/run.sh, android/checks/run.sh, pnpm verify all run and their output is quoted
- [x] #6 git diff confirms NFCTimeSheets.entitlements/project.pbxproj/IPHONEOS_DEPLOYMENT_TARGET untouched
- [x] #7 backlog tasks 271-274 reflect real status with evidence, gaps named explicitly rather than glossed over
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED 2026-08-26 after the two follow-up commits, 670a862 (iOS) and 997a824 (Android). AC#3 now holds on BOTH platforms, read first-hand not on trust: Android unchanged and still gated on app.operatorCookies.header() != null; iOS OperatorSession.refresh() guards on the ts_operator cookie in HTTPCookieStorage and OperatorHomeScreen re-runs it in .onAppear, so the gate is the session and it is re-read, not a UserDefaults flag decided once per install. A 401 posts .operatorSessionRejected (never the worker's .sessionRejected) and drops the state to signed-out. checks/operator-gate-check.swift now makes the same assertions for iOS that core-check.kt has always made for Android; I ran its RED case. AC#1 follows: the one place code contradicted decision-54 (§4, the gate) is fixed, and decision-54 §3's unbind - flagged in item 7 of the review, filed as TASK-277 - now has a client on both platforms with the 409 zone_has_shifts refusal rendered as a sentence in de and en, no new server route and no admin-panel affordance. Checks re-run for this closure: NFCTimeSheets/checks/run.sh OK (12 checks, 236 keys all German), iOS Release build (CODE_SIGNING_ALLOWED=NO) SUCCEEDED, android/checks/run.sh OK, gradlew compileDebugKotlin assembleDebug BUILD SUCCESSFUL, entitlements/pbxproj empty git diff. Still not pushed, still not deployed. Left open deliberately, not as gaps in this gate: TASK-279 (decision-49 §4 two cookie jars, pre-existing) and TASK-280 (check-telemetry-wire, pre-existing). gradlew lint remains red on 117 pre-existing NewApi java.time errors in untouched files - unrelated to this rollout, not filed here.
<!-- SECTION:NOTES:END -->
