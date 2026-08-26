---
id: TASK-275
title: 'Review gate: decision-54 rollout (backend + admin web + Android + iOS)'
status: In Progress
assignee: []
created_date: '2026-08-26 17:14'
updated_date: '2026-08-26 18:09'
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
- [ ] #1 decision-54 and its amended decisions are read and no code contradicts them
- [x] #2 decision-44's adopted-hardware tag-serial flow is confirmed untouched
- [ ] #3 operator interface is confirmed unreachable without sign-in on both platforms, by reading the actual gate code
- [x] #4 zone-shifts payload confirmed to carry no rate/money/client fields
- [x] #5 server/check-api.js, ops/check-branding.mjs, NFCTimeSheets/checks/run.sh, android/checks/run.sh, pnpm verify all run and their output is quoted
- [x] #6 git diff confirms NFCTimeSheets.entitlements/project.pbxproj/IPHONEOS_DEPLOYMENT_TARGET untouched
- [x] #7 backlog tasks 271-274 reflect real status with evidence, gaps named explicitly rather than glossed over
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW RUN 2026-08-26. VERDICT: ONE BLOCKING PROBLEM, on iOS. Backend, admin web and Android are clean.

AC#1 and AC#3 left UNCHECKED: decision-54 §4 is not satisfied on iOS (TASK-276). Everything else verified.

1. NO ADMIN PATH CREATES A ZONE — CLEAN.
   INSERT INTO zones exists once in the whole server: routes/operator.js:264. admin.js:1769-1792 replaces resolveTagToZone with a comment block, route-table entry gone (admin.js:2634 diff). admin.js:1671 fail(410, zone_creation_moved_to_operator_app) when no id; the UPDATE branch at :1687-1697 is unchanged. Observed live: 'POST /admin/tags/<id>/resolve-zone 404', 'POST /admin/zones 410 err=zone_creation_moved_to_operator_app'. decision-47's resolve-building pin still green.

2. decision-44 ADOPTED-SERIAL WALK — UNTOUCHED, proved by extraction not by hunk headers.
   submitZone() and the whole 'hidden={zoneStep !== 2}' block extracted from b77523c~1 and b77523c and diffed: IDENTICAL, 75 and 100 lines. Last hunk in that file ends at new line 2153; the step-2 block starts at 2266. KnownTags.kt, Zones.kt and /roster's tag_serial CASE (app.js:147) are not in the 56440ea..HEAD file list at all. android known-tags-check OK.

3. OPERATOR GATE — ANDROID CLEAN, iOS BROKEN.
   Android: TimeSheetApp.kt:277-323, 'if (!ready) { ...; return }' before the buttons; ready = app.operatorCookies.header() != null (TimeSheetViewModel.kt:230), re-read every resume; both activities exported=false; core-check pins all of it.
   iOS: OperatorHomeScreen.swift:30 branches on OperatorSession.state, which comes from a UserDefaults integer (OperatorSession.swift:51-56), never from the cookie. state = .signedOut is set in one place (:96) that no view calls. A worker sign-out (ContentView.swift:680 -> Auth.swift:180) kills ts_operator and leaves the flag, so the gate stays open on a dead session with no in-app recovery. TASK-276, TASK-279.

4. ONE SHARED CODE FORM — CLEAN, both platforms.
   Android: declared TimeSheetApp.kt:388, called :210 and :302. iOS: CodeSignInSection.swift, called ContentView.swift:147 and OperatorHomeScreen.swift:44. Enumerated every text field on both: the only other ones are the WriteGuard overwrite-confirm (decision-49), the zone-name field, and the materials field. No leftover second code UI.

5. ZONE-SHIFTS PAYLOAD — CLEAN.
   operator.js:456-459 selects worker_id, worker_name, start_time, end_time, duration_minutes and nothing else. check-api.js:6741 deepEquals that exact key set and separately asserts hourly_rate_cents / pay_cents / client_name / monthly_contract_cents / location_name are undefined.

6. UNBIND REFUSAL IS THE DATABASE'S — CLEAN.
   operator.js:363-372: bare UPDATE, 'if (err?.code === 23503) fail(409, zone_has_shifts)'. No SELECT-then-decide. check-api.js:6575-6615 raises it from real shift rows through BOTH shifts_start_zone_fk and shifts_end_zone_fk, asserts the UPDATE did not happen, then deletes the shifts and proves the same call succeeds — so it is not a route that refuses everything.

7. UNBIND CLIENT — MISSING ON BOTH PLATFORMS, not just iOS.
   Zero matches for 'unbind' under NFCTimeSheets/, android/ and web/. decision-54 §3's 'rebinding is unbind-then-bind' therefore has no reachable surface anywhere, and §2/§3 removed the admin's ability too. Outside both mobile tasks' ACs, so neither is reopened for it. Filed as TASK-277.

CHECKS, all run by me:
  server/check-api.js (postgres:///ts_check275, full 001-013 replay)  1 FAILED / 1044 lines
      the only failure: 'the REAL SDK payload leaks nothing and lands as ONE trace' -> check-telemetry-wire
      REPRODUCED MYSELF in a fresh worktree at 8162f90, pre-9f2faf2: identical FAIL. Filed as TASK-280.
  server/check-sms-flag.mjs           OK   ('no SMS was sent to any real number by this run')
  ops/check-branding.mjs              OK   14 ok lines, ZERO TODO lines (TASK-188's iOS-host TODO is closed)
  NFCTimeSheets/checks/run.sh         OK   11 checks, incl. entitlement-format-check and localisation-check (222 keys, all German)
  android/checks/run.sh               OK   core / known-tags / tag-writer / manifest / verify-no-shift
  cd web && pnpm verify               EXIT 0  (1 pre-existing Biome warning, app/payroll/page.tsx:749, not in this diff)

ENTITLEMENTS / PBXPROJ: byte-identical across the whole session. Blob SHAs at 56440ea, b77523c and HEAD are all 95a3cb4f2b2bf7ea4205eb117ef8f9fcf44dc250 (entitlements) and 480a727855ea4c405dfdd9a15a1a1584dc7f025e (pbxproj). IPHONEOS_DEPLOYMENT_TARGET lives inside pbxproj, so it is covered.

NOT PUSHED, NOT DEPLOYED:
  git rev-list --count origin/main..HEAD = 7. Working tree clean.
  Live API read-only probe: GET https://schimmer-glanz.exe.xyz/operator/locations -> 404 {"error":"not_found"} (route does not exist there); control GET /operator/zones -> 401 {"error":"unauthorized"} (routed, old build). Production is on the pre-decision-54 code.

BACKLOG CHANGES: 271/272/273 stay Done, each with first-hand evidence appended. 274 -> In Progress, AC#2 unchecked. New: TASK-276 (iOS gate), TASK-277 (unbind client), TASK-278 (iOS i18n), TASK-279 (decision-49 §4, pre-existing), TASK-280 (telemetry, pre-existing).
<!-- SECTION:NOTES:END -->
