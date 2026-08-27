---
id: TASK-296
title: 'Review gate: decision-57 feature flags + playful shift screen'
status: Done
assignee: []
created_date: '2026-08-27 10:39'
updated_date: '2026-08-27 16:10'
labels:
  - review
  - decision-57
dependencies:
  - TASK-292
  - TASK-293
  - TASK-294
  - TASK-295
priority: medium
ordinal: 214000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 re-read decision-57 in full; confirm flag OFF is byte/pixel-identical to pre-decision-57 behavior on both platforms
- [x] #2 confirm a flags-role admin session is refused on every admin route except /admin/flags (spot-check at least 3 other routes)
- [x] #3 confirm the animation never covers/obscures the state words under the clock on either platform
- [x] #4 entitlements/pbxproj/IPHONEOS_DEPLOYMENT_TARGET byte-identical across the whole commit range
- [x] #5 all relevant check suites run with output quoted; existing wallpaper/brand checks specifically re-run and shown still green
- [x] #6 nothing pushed, nothing deployed; note that provisioning the real second admin account on production is a manual owner/assistant follow-up, not part of this gate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
REVIEW GATE VERDICT: decision-57 PASSES. Every AC verified independently by reading the
diffs and re-running the checks, not from any prior agent's self-report. Four findings, none
of them a decision-57 violation, filed as TASK-303/304/305/306 (+307).

AC1 - FLAG OFF IS TODAY'S SCREEN, BOTH PLATFORMS.
iOS: the OFF branch is untouched code - tint stays 'overdue ? .red : .green' and the
background stays 'tint.opacity(0.14)'; the flag only adds a ternary and a ViewBuilder branch.
@AppStorage defaults false; FeatureFlags.enabled() reads defaults.bool (absent == false);
refreshFlags() swallows any failure, so a server with no /flags leaves the cache standing.
Android: TimeSheetsTheme untouched; container/onContainer still MaterialTheme roles on the OFF
branch; the only structural change is that .background(container) moved from the Column onto a
new same-size parent Box that holds exactly one child when the flag is off. Proven on a device,
not argued: on a debug APK built from HEAD (versionCode 23), check-app-not-wallpaper's
two-palette render hash is 19075b06e62d7316, BYTE-IDENTICAL to the same check on versionCode 20
(pre-decision-57), and check-shift-screen-brand measures the running screen achromatic
(#F0F1F3 65.6% spread 3, #FFFFFF 30.1% spread 0, #16181C 2.4% spread 6; worst 6, budget 12).

AC2 - THE SCOPED ROLE IS REFUSED EVERYWHERE ELSE. Structural, not per-handler:
requireAdminSession(headers, allowedRoles = ['admin']) refuses a 'flags' row before any handler
runs, and answers the SAME 401 (never a 403) an anonymous caller gets, so the account cannot
enumerate routes. Only auth:'flags' routes widen it. check-api.js re-run by the gate probes
EIGHT other routes - GET /admin/data, /admin/session, /admin/sms-status, POST /admin/workers,
/admin/locations, /admin/operators, /admin/logout, /admin/password - each compared byte-for-byte
against the anonymous answer; all 401/401 pairs. Full admin unaffected (/admin/data 200).

AC3 - THE ANIMATION NEVER COVERS THE STATE WORDS. iOS by construction: the silhouettes live
inside .background(...) of the ScrollView, so they are behind the content by z-order, at
ctx.opacity 0.22, accessibilityHidden. Android by construction and by photograph: FunShiftBackdrop
is the FIRST child of the Box and the Column is drawn over it, clearAndSetSemantics hides it from
TalkBack, and the figures are confined to the bottom fifth. Flag-ON screenshot on the emulator:
'Eingestempelt', the building name, 0:00:07 and 'Laeuft' fully legible; #000000 58.2% (the
literal FunShift.Black), text #E9EAEC, and the figure region measures #1A1D22 at 24.4% - the
documented 1.2:1 texture, confirmed on a real screen rather than asserted in a comment.

AC4 - ENTITLEMENTS / PBXPROJ / DEPLOYMENT TARGET. Proven by blob identity across every commit
in the range f628b54..8521a18:
  project.pbxproj              480a727855ea4c405dfdd9a15a1a1584dc7f025e
  NFCTimeSheets.entitlements   95a3cb4f2b2bf7ea4205eb117ef8f9fcf44dc250
IPHONEOS_DEPLOYMENT_TARGET = 18.0 at all six occurrences, unchanged. decision-49 respected.

AC5 - EVERY SUITE RUN BY THE GATE, output quoted in this task's history:
  server/check-api.js       1 FAILED - 'a failed SMS reports the VOCABULARY WORD and nothing
                            else'. PRE-EXISTING: reproduced identically at f628b54 in a clean
                            worktree, and already tracked as TASK-280. Nothing else red; the
                            whole decision-57 block passes.
  android/checks/run.sh     OK (core, known-tags, tag-writer, manifest, verify-no-shift,
                            reader-armed)
  NFCTimeSheets/checks/run.sh  OK (12 checks incl. new flags-check 'OK (4 figures, flags
                            default OFF)' and entitlement-format-check)
  web pnpm verify           exit 0 (check.mjs incl. en/de key-set + ICU parity, biome,
                            tsc, next build - /flags prerendered static)
  demo/check-fun-shift-black.mjs  OK, 10 assertions
  demo/check-app-not-wallpaper.mjs OK on a build of this change
  demo/check-shift-screen-brand.mjs OK on a build of this change (details on TASK-295)
  gitleaks over the range: no leaks. psst scan: the 2 hits are the vaulted PORT false
  positive the commit message named - verified, not taken on trust.

AC6 - NOTHING PUSHED, NOTHING DEPLOYED. origin/main is still 68743c6; HEAD 8521a18 is 6
commits ahead, local only. No deploy.sh run, no ssh to the box. The live 'flags'-role admin
row is still NOT provisioned - that is a manual owner/assistant step (INSERT with role='flags',
password generated into psst, never into chat), explicitly out of scope here per TASK-292 AC6.

FINDINGS FILED (none blocks decision-57):
  TASK-303 (high)  TASK-301's fix gates ARMING only; nothing calls disableReaderMode, so the
                   stray-tap bug it was filed for still lands. Same hole in the reassign flow.
  TASK-304 (high)  demo/android-setup.sh maps only the tag host while Api.kt calls API_HOST
                   (decision-40), so device checks silently talk to PRODUCTION. Observed: a
                   locally minted enrolment code rejected by the live box while the local
                   server logged nothing.
  TASK-305 (med)   check-shift-screen-brand.mjs exits 0 on every bail-out path - a run that
                   printed FAIL reports success to anything reading the exit code.
  TASK-306 (low)   fe9abda (TASK-298) carries a decision-57 line whose function lands three
                   commits later: that commit does not build. Bisect hazard, one shared tree.
  TASK-307 (med)   demo/seed.sql is behind migrations 014/015 - a fresh demo DB 500s on
                   GET /admin/data until they are applied by hand.
<!-- SECTION:NOTES:END -->
