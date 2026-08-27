---
id: TASK-291
title: 'Review gate: decision-56 manual clock-in/out'
status: Done
assignee: []
created_date: '2026-08-27 09:43'
updated_date: '2026-08-27 11:13'
labels:
  - review
  - decision-56
dependencies:
  - TASK-287
  - TASK-288
  - TASK-289
  - TASK-290
priority: high
ordinal: 209000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 re-read decision-56 in full; confirm the shipped code matches it exactly (manual_start/manual_close semantics, corrected_at set only on manual close, auto_closed untouched)
- [x] #2 confirm a manual open cannot succeed anywhere a real tap would fail (read v.activePlace/v.requireVerifiedPlace call sites, do not trust tests alone)
- [x] #3 confirm a plain tap-based open/close (manual omitted) is byte-identical in behavior to before this change
- [x] #4 confirm both platforms require a confirmation step before either manual action fires
- [x] #5 confirm admin can see manual_start/manual_close on at least one real row (server + web working together)
- [x] #6 entitlements/pbxproj/IPHONEOS_DEPLOYMENT_TARGET byte-identical across the whole commit range
- [x] #7 all relevant check suites (server check-api.js, android checks/run.sh, iOS checks/run.sh, web pnpm verify) run with output quoted
- [x] #8 nothing pushed, nothing deployed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW GATE: PASS (with 3 filed follow-ups; nothing blocks).
Range reviewed: 5135560..aea4157 (883efb2 landed mid-review, .md only, does not affect this).
Every claim below was re-derived from code/artefacts, not from the implementing agents' notes.

AC1 decision-56 vs shipped code - MATCHES.
  014_manual_shift_entry.sql: ALTER TABLE shifts ADD manual_start/manual_close BOOLEAN NOT NULL DEFAULT false. Applied on a FRESH db (createdb + db/migrate.js, 14 migrations), psql \\d shifts:
    auto_closed boolean not null false / corrected_at timestamptz / manual_start boolean not null false / manual_close boolean not null false
  app.js:344 UPDATE ... manual_close = manual_close OR $6, corrected_at = CASE WHEN $6 THEN now() ELSE corrected_at END - one UPDATE, auto_closed NOT touched by the manual flag (auto_closed = auto_closed OR $3 unchanged).

AC2 manual open cannot succeed where a tap fails - CONFIRMED BY READING, not by tests.
  app.js openShift order: v.activePlace(body.location_uuid) [l.190] -> v.requireVerifiedPlace(place) [l.199] -> v.timestamp -> const manual = v.bool(body.manual) [l.206]. The flag is read AFTER both gates and is used ONLY as INSERT column 6.
  grep 'manual' over server/routes/*.js + server/lib/*.js: no branch anywhere keys on it. validate.js requireVerifiedPlace()/activePlace() have no manual awareness.
  Only two INSERT INTO shifts exist: app.js:216 (this one) and admin.js:2082 (admin-typed, no manual).
  Live: POST /shifts/open {manual:true} on an unverified zone -> 422 zone_unverified, 0 rows written (same code a tap gets).

AC3 plain tap open/close byte-identical - CONFIRMED ON ALL THREE CLIENTS.
  server: v.bool(undefined) -> false (validate.js:322). manual_close OR false = no-op; CASE WHEN false -> corrected_at unchanged. check-api: 'a plain tap close is byte-for-byte unaffected: both flags false, corrected_at null' ok.
  iOS: manual is Bool? and nil is OMITTED by JSONEncoder - proven by running a standalone swift encode:
    tap    : {"client_uuid":"c","location_uuid":"l","start_time":"1970-01-01T00:00:00Z"}
    manual : {"client_uuid":"c","location_uuid":"l","manual":true,"start_time":"1970-01-01T00:00:00Z"}
    and independently by checks/tag-link-check.swift, which still pins the OLD tap bodies verbatim.
  Android: listOfNotNull drops manual when false; core-check.kt's pre-existing pinned open/close bodies still pass unchanged (core-check: OK).
  Only new refusal: manual:'true' (string) -> 400 invalid_field. No shipped client sends the field at all, so not a regression.

AC4 confirmation on both platforms before EITHER action - CONFIRMED.
  iOS ContentView.swift: 'Start without a tag' -> sheet -> pick building -> toolbar Start sets confirmingManualStart -> .confirmationDialog('Start a shift at %@?') -> 'Start shift' -> startManual(). ShiftScreen.swift stopButton -> confirmingStop -> .confirmationDialog('Finish your shift at %@ now?') -> 'Finish now'.
  Android TimeSheetApp.kt: TextButton -> ManualStartDialog (confirm Button disabled until a building is selected) ; OutlinedButton -> ManualStopDialog (names the building, R.string.manual_stop_body) -> confirm Button. Neither is one tap.
  iOS manual-open is unreachable while a shift runs (the button is in idleList, rendered only when running == nil), and handleTap only sets manualStart in the create branch.

AC5 admin sees the flags on REAL rows - PROVEN END TO END (server + web, local stack on :8199, static export via PUBLIC_DIR).
  GET /admin/data returned: {ms:false,mc:false}, {ms:true,mc:false}, {ms:true,mc:true,corrected:true,auto:false}.
  Screenshots via ops/screenshot.mjs, logged in as a throwaway admin:
    /shifts/  -> row2 'Start manuell erfasst'; row3 'Start manuell erfasst' + 'Ende manuell erfasst' + status 'Korrigiert'; row1 nothing. All three distinguishable in greyscale.
    /         -> 'Gerade im Einsatz' shows 'Do., 12:40 - Start manuell erfasst'; 'Zuletzt erfasste Schichten' shows the same two labels.
  Throwaway db dropped, seed script deleted, local server stopped.

AC6 entitlements / project.pbxproj / IPHONEOS_DEPLOYMENT_TARGET - BYTE-IDENTICAL across 5135560..HEAD.
  git diff --name-only 5135560..HEAD | grep -icE 'entitle|pbxproj|xcodeproj' -> 0
  git diff --stat 5135560..HEAD -- NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj -> EMPTY
  Why a NEW file (ShiftMockFlows.swift) needs no pbxproj edit: the project uses PBXFileSystemSynchronizedRootGroup (5 occurrences), so no .swift is listed explicitly. decision-49's 'no agent edits the entitlement or project.pbxproj' held.
  ops/check-branding.mjs: check-branding: OK, 14 ok lines, zero TODO/FAIL.

AC7 check suites - ALL RUN BY THE GATE ITSELF.
  server/check-api.js  -> 228 ok, 'check-api: 1 FAILED'. The single failure is 'the REAL SDK payload leaks nothing and lands as ONE trace' = TASK-280, pre-existing, telemetry-only, reproduced at 8162f90 long before decision-56. The 4 new decision-56 cases all ok.
  server/check-close-flag.mjs -> 7 pass, 0 fail. db/check-migrate.js -> OK. check-phone-namespace -> PASS. check-sms-message -> OK. check-field-wire / check-prod-restore -> SKIP (need a prod dump).
  android/checks/run.sh -> exit 0: core-check OK, known-tags-check OK, tag-writer-check OK, manifest-check OK, verify-no-shift-check OK.
  Android DE/EN strings parity checked by hand (no gate exists): 329 keys each, diff empty.
  NFCTimeSheets/checks/run.sh -> exit 0: tag-link, tap-inbox, migration, scrub, materials, shift-signal, ndef-tag, write-guard, localisation (268 keys, all German), operator-gate, entitlement-format - all OK.
  web pnpm verify -> exit 0: 'All checks passed.', biome 72 files 1 warning (pre-existing app/payroll/page.tsx:749 useOptionalChain, untouched), tsc clean, next build 18 routes.
  EXTRA, not asked for and not previously run by anyone: xcodebuild Debug AND Release for the simulator -> ** BUILD SUCCEEDED ** both, 0 errors 0 warnings. Nothing in this workflow had ever compiled the Swift.
  Release artefact grep (TASK-290 AC5, proven against the BINARY not the source): TSShiftMockFlowArmed 0, 'Mock: the server accepts a manual start' 0, 'Mock: the server accepts a manual stop' 0, ShiftMocks 0; control 'Start without a tag' 1. Derived data deleted after.

AC8 nothing pushed, nothing deployed. origin/main is still 68743c6; 13 commits sit local-only. No deploy.sh, no ssh to the VM. The only runtime touched was a local throwaway Postgres db + a local :8199 node process, both gone.

GAPS FILED (none blocks decision-56; see TASK-298, TASK-299, TASK-300):
  1. iOS 'Manual' pill ships ENGLISH on a German phone. ContentView.swift:631 pill('Manual', .blue) and pill(_ t: String) does Text(t) - the String overload, which is VERBATIM, never localized. Proof: the compiled de.lproj/Localizable.strings has 'Manual' => 'Manuell' but the three sibling pills at :632-634 ('In progress'/'Auto-closed'/'Corrected') have NO catalogue entry at all, because the compiler never extracted any of them. The catalogue entry is unreachable dead weight. localisation-check.swift cannot see this - its own header says so.
  2. web /shifts still prints 'Am Tag gescannt' on a manual-start row, directly above 'Start manuell erfasst'. shifts/page.tsx:1130 branches on isManualEntry (client_uuid IS NULL) only.
  3. web payroll under-reports. lib/payroll.ts:103 counts isManualEntry only, and payroll's caveatManual says '...instead of being tapped on a tag. The tag log has no record of them' - now false for every decision-56 manual row, which is exactly the population that sentence describes.
  4. CAVEAT, not a gap: android/checks/release-artefact.sh needs a built APK and was NOT run, so Android's 'no simulation in release' is proven by source-set split only. iOS's equivalent was proven against the binary.
<!-- SECTION:NOTES:END -->
