---
id: TASK-284
title: 'Review gate: decision-55 rollout (backend, Android, iOS)'
status: Done
assignee: []
created_date: '2026-08-26 20:59'
updated_date: '2026-08-27 06:49'
labels:
  - review
  - decision-55
dependencies:
  - TASK-281
  - TASK-282
  - TASK-283
priority: high
ordinal: 202000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same shape as TASK-275. Read decision-55 and decision-54 in full, read all code changes from TASK-281/282/283, verify no code contradicts either decision, check the no-partial-application CTE guard by reading the actual SQL (not trusting a green test alone), verify zone-shifts/reassign payloads never leak rate/money/client data, verify entitlements/pbxproj/deployment-target byte-identical across the whole commit range, run server/check-api.js + android/checks/run.sh + NFCTimeSheets/checks/run.sh + ops/check-branding.mjs and quote any non-clean output. Report violations with decision id + file:line. BLOCK completion if found.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 decision-55 and decision-54 both read in full before review
- [x] #2 all TASK-281/282/283 code changes reviewed against both decisions with file:line citations
- [x] #3 reassign-building's no-partial-application guarantee verified by reading the actual SQL, not just a passing test
- [x] #4 zone-shifts and reassign-building payloads confirmed to carry no rate/money/client fields on any platform
- [x] #5 entitlements/project.pbxproj/deployment-target confirmed byte-identical across the full commit range
- [x] #6 all 4 check suites (server/check-api.js, android/checks/run.sh, NFCTimeSheets/checks/run.sh, ops/check-branding.mjs) run and their output quoted
- [x] #7 TASK-281/282/283 independently re-verified against actual code (not self-reports) before being marked Done
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERDICT: PASS on all 7 criteria. 2 new tasks filed (TASK-285, TASK-286); neither falsifies a claimed AC on TASK-281/282/283, so all three stay Done. Nothing pushed, nothing deployed.

AC#1 decision-55, decision-54, decision-47 all read in full before any judgement.

AC#2 code reviewed with file:line, not self-reports:
- server/routes/operator.js:406-495 (classifyTag), :497-620 (reassignZoneBuilding), :711-722 (route table, exactly 2 new entries).
- NFCTimeSheets/NFCTimeSheets/OperatorTagMint.swift (new, shared), VerifyZoneScreen.swift:211-300 + :406-580, WriteTagScreen.swift:196-247, OperatorAPI.swift:477-513.
- android/.../VerifyZoneActivity.kt:403-412 (bound branch guard), :443-445 (one ZonePage call site), :485-560 (ReassignSection), :1185-1210 (onTag write), core/Wire.kt, net/Api.kt.

AC#3 no-partial-application PROVED, not trusted. Read the CTE at operator.js:558-576 end to end: old (plain SELECT, active AND location_id IS NOT NULL) -> claim (UPDATE reported_tags ... AND EXISTS (SELECT 1 FROM old)) -> minted (INSERT ... SELECT FROM claim CROSS JOIN old) -> retired (UPDATE zones SET active=false ... AND EXISTS (SELECT 1 FROM minted)). Every route runs on pool.query with NO explicit transaction anywhere (grep -rn "BEGIN|pool.connect" server/routes/*.js -> nothing), so the statement IS the transaction and a 23505 rolls the whole chain back.
Then RAN the exact statement against a real Postgres in a throwaway schema, four adversarial cases:
  A old zone ALREADY RETIRED (inactive): 0 rows; tag claimed=f; zones_with_that_tag_id=0
  B new_tag_id ALREADY RESOLVED:         0 rows; old zone active=t location_id=ALT
  C duplicate_zone_name in TARGET:       ERROR duplicate key ... "zones_one_live_name_idx"; after it old zone active=t bound to ALT, tag claimed=f, minted_rows=0
  D target = the zones OWN building:     same 23505, same untouched state
FOUND, and filed as TASK-285 (does NOT breach decision-55 section 3): two OVERLAPPING reassigns of one zone into two DIFFERENT buildings both mint. Raced it live -> A minted bbbb-0003 (NEU), B minted bbbb-0004 (DRITT), old zone retired once. Cause: old is a plain SELECT and the retired UPDATE asks only "id = $1 AND EXISTS(minted)", so the second statements EPQ recheck still matches. The naive fix (re-predicate the retired UPDATE) would CREATE a real partial application; the fix is FOR UPDATE in the old CTE. Written into TASK-285 in full.

AC#4 no rate/money/client on any surface. Server: OP_ZONE_COLS = "id, location_id, name, tag_serial, tag_deployed_at, verified_at" (operator.js:214); listZoneShifts (:638-694) selects worker_id, worker_name, start_time, end_time, duration_minutes + count/total_minutes only; reassign 201 body is {zone: OP_ZONE_COLS, retired_zone_id}. Clients: WireOperatorZone / WireZoneShift (Wire.kt:316-369) and WireOperatorZone / WireReassignedZone (OperatorAPI.swift:314-360) carry no such field. grep -rniE "rate|cent|euro|money|client|kunde|preis|betrag|hourly" over VerifyZoneActivity.kt, VerifyZoneScreen.swift, OperatorAPI.swift returns only comments ASSERTING the absence.

AC#5 byte-identical, proven twice:
  $ git diff 0510eb0..6977f4b -- NFCTimeSheets/NFCTimeSheets/NFCTimeSheets.entitlements NFCTimeSheets/NFCTimeSheets.xcodeproj/project.pbxproj | wc -l
  0
  $ git diff 0510eb0..HEAD -- (same two paths) | wc -l
  0
  sha1 entitlements @0510eb0 / @6977f4b / @HEAD: a0dc466751dafb913debffe5e619b5f40864b572 (all three)
  sha1 pbxproj      @0510eb0 / @6977f4b / @HEAD: 5be2eac7c24204519e8594ac4b9ededdb1f2afe3 (all three)
  IPHONEOS_DEPLOYMENT_TARGET = 18.0; occurs 6x at every one of the three revs.

AC#6 all four suites run by this gate, real output:
  server/check-api.js       223 ok, "check-api: 1 FAILED" = "the REAL SDK payload leaks nothing and lands as ONE trace" (check-telemetry-wire) -> PRE-EXISTING, TASK-280, telemetry files untouched by this range. Nothing else fails. The 3 decision-55 cases are green.
  android/checks/run.sh     core-check OK, known-tags-check OK, tag-writer-check OK, manifest-check OK, verify-no-shift-check OK, exit=0
  NFCTimeSheets/checks/run.sh  11/11 green incl. localisation-check OK (253 keys, all German) and entitlement-format-check OK; "checks: OK", exit=0
  ops/check-branding.mjs    14 ok, "check-branding: OK", exit=0 - and NO TODO lines this run (the TASK-188 iOS-host TODO is gone; "iOS talks to apiHost and claims tagHost" is ok)
Beyond the four: forced a real recompile (gradlew --offline compileDebugKotlin compileReleaseKotlin --rerun-tasks -> BUILD SUCCESSFUL, 16 tasks executed, only 2 pre-existing "No cast needed" warnings in untouched files) and typechecked iOS both ways (xcrun swiftc -typecheck -swift-version 5 -target arm64-apple-ios18.0 over NFCTimeSheets/*.swift, with and without -D DEBUG, exit=0 both).

AC#7 TASK-281/282/283 re-verified against code, not notes:
- 281: 2 new routes only; classifyTag makes NO activePlace call (grep for "v.activePlace(" in :455-620 -> empty; the one hit at :471 is a comment), and server/lib/ + server/db/ are untouched across 0510eb0..HEAD (empty --stat). 5 kinds in the documented order at :462-493, inactive building -> unknown.
- 282: worklist-first intact (handleRead unchanged, "val target = selectedZone ?: return"); the only removals are readerWanted()/onTag gates. ONE ZonePage (defined :731, called :443). BuildingPicker is ui/BuildingPicker.kt, shared with WriteTagActivity. The write is app.tagWriter (TimeSheetsApplication.kt:90, the same instance WriteTagActivity.kt:513 uses) - no NDEF primitive added (git diff shows no +/- line touching Ndef.get/NdefMessage/writeNdef). DE/EN parity: 319 keys each, diff empty; all 81 R.string refs in VerifyZoneActivity.kt present in BOTH files. Release stub VerifySimulation.kt returns emptyList()/null for the new hooks.
- 283: mint-write-report EXTRACTED to OperatorTagMint.swift and WriteTagScreen.swift now CALLS it (:199-224) - one implementation, not two. No "import CoreNFC" outside NdefTag/TagReaderProbe/TagWriter. One BuildingPicker (BuildingPicker.swift:24), one selectedZoneSection (:331). Both new API methods go through the existing operatorGet/operatorPost choke point (OperatorAPI.swift:491, :511).
NOTED, pre-existing and already filed: those two calls therefore inherit TASK-279 (decision-49 section 4 never implemented on iOS - OperatorAPI.swift:75 still URLSession.shared, one cookie jar). This range does NOT worsen it; it used the existing choke point instead of adding a second path. TASK-279 stays To Do.

AC#5/AC#6 companion - nothing pushed, nothing deployed:
  $ git status --porcelain   -> (empty)
  $ git log --oneline -1 origin/main  -> 0510eb0 ios: fix German plurals on the migration receipt (TASK-40), drop dead ci hook code
  $ git log --oneline -1 HEAD         -> 06c2537 backlog: decision-55 + TASK-281..284 record files
  $ git rev-list --count origin/main..HEAD -> 4   (0cb3215, 6977f4b, 2fdb036, 06c2537 all local)
  Live API probe, read-only, one request each - route matching runs BEFORE auth (server.js:216-238), so 404 vs 401 tells deployed from not:
  $ curl https://schimmer-glanz.exe.xyz/operator/tags/1111...1111  -> {"error":"not_found"} HTTP 404   (new route NOT deployed)
  $ curl https://schimmer-glanz.exe.xyz/operator/zones             -> {"error":"unauthorized"} HTTP 401 (control: pre-existing route IS deployed)

NEW TASKS FILED: TASK-285 (server, medium - concurrent double-mint; carries the do-not-do-the-naive-fix warning), TASK-286 (android, low - reassign picker offers the zones own building, burns a written card for a misleading 409; iOS already guards it at VerifyZoneScreen.swift:434).
<!-- SECTION:NOTES:END -->
