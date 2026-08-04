---
id: TASK-36
title: 'The demo rig: reproducible recordings with production-safety guards'
status: Done
assignee: []
created_date: '2026-08-04 17:43'
updated_date: '2026-08-04 17:43'
labels:
  - demo
  - tooling
  - infra
dependencies: []
priority: medium
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retro-filed 2026-08-04 during backlog triage (triage agent 2). No task ever covered this; the work is shipped and checked in at commit d564af2 plus the verify-phase fixes.

Build a rig that records the product — admin panel, iOS, Android — from the REAL app against a REAL server, never a mocked UI, and that cannot touch production while doing it.

Lives in demo/: record-admin.mjs, record-ios.mjs, record-android.mjs, compose-devices.mjs,
demo-server.mjs, ios-setup.sh, android-setup.sh, tls-front.mjs, check-guards.sh, burnin.mjs,
journey.mjs, cdp.mjs, make-admin.mjs, png.mjs, seed.sql, db-guard.mjs, check-captions.mjs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Records the real admin panel, real iOS build and real Android build - no animated fake UI
- [x] #2 Demo build points at a loopback server WITHOUT modifying any tracked file
- [x] #3 Guards refuse any database not named nfc_demo, and any non-loopback host
- [x] #4 Guards are proven by mutation: removing one makes check-guards.sh FAIL
- [x] #5 A refusing process EXITS rather than hanging the suite
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, and the guards are proven rather than asserted.

EVIDENCE IN THE TREE: demo/ holds 17 scripts. Recorded output in docs/media/ —
  admin-walkthrough.mp4 (163 s, 11 admin screens), both-devices.mp4 (144 s, iOS + Android side
  by side), ios-journey.mp4 (115 s), android-journey.mp4 (132 s), demo-write-tag.mp4 (30 s,
  real physical tag), 11 admin-*.png stills.

WHY THE iOS DEMO IS HONEST (it was wrongly declared impossible in an earlier run):
- TS_TAG_HOST is an xcconfig variable overridden ON THE xcodebuild COMMAND LINE. The demo build
  points at loopback and NO TRACKED FILE CHANGES.
- demo-server.mjs issues its own Apple-shaped key; the app still verifies signature, issuer,
  audience, expiry and nonce FOR REAL. Nothing in the app was weakened to make the demo work.
- simctl genuinely cannot hand a universal link to an app, so DemoHooks.swift feeds the SAME
  TapInbox the URL path feeds, entirely inside #if DEBUG. Every such tap is captioned MOCKED.

GUARDS — 16 cases in demo/check-guards.sh (was 12). seed.sql, make-admin.mjs and demo-server.mjs
refuse any database not named nfc_demo; demo-server.mjs, record-*.mjs, tls-front.mjs and
ios-setup.sh refuse non-loopback hosts.

check-guards.sh uses must_refuse(), which treats a process SURVIVING 5 s as the FAILURE. That is
the important design choice: a server that refuses EXITS, while one whose guard is missing
LISTENS FOREVER — which once hung the suite for 39 minutes looking like a slow test. A test that
hangs is a test that cannot fail.

TWO REAL DEFECTS FOUND BY THE VERIFY PHASE AND FIXED:
1. PRODUCTION WAS REACHABLE DESPITE THE GUARD. postgres:///nfc_demo?host=timesheets.exe.xyz and
   a bare PGHOST=timesheets.exe.xyz both connected to the LIVE host — proven by intercepting
   net.Socket.connect and observing [5432,'timesheets.exe.xyz']. libpq honours a host query
   parameter OVER the URL host, and pg falls back to $PGHOST. demo/db-guard.mjs is now the
   single decision point. The old-style test could never have caught it: with the guard removed
   make-admin.mjs still exits non-zero, because it dials the live host and the connection dies.
   The four new cases therefore assert on the WORDING of the refusal, not the exit code.
2. OVERPRINTED CAPTIONS. ffmpeg between(t,a,b) is inclusive at both ends and one caption's
   'until' equalled the next's 'at', so boundary frames drew two lines — exactly 2 frames
   repo-wide. burnin.mjs now emits half-open gte*lt; demo/check-captions.mjs catches regressions.

Both fixes were mutation-tested: reverted, saw the FAIL, restored.

RUNNABLE CHECK: bash demo/check-guards.sh  (16 cases) and node demo/check-captions.mjs

PRIVACY: 0 audio streams on all 5 clips. The verify phase also caught a leak OUTSIDE this repo —
~/Desktop/demos/hoiv/nfc-timesheets/clips/stills/app-shift.png was byte-identical (sha256
4920c2ad…) to the file this repo deleted at 33e66b2 for carrying a real third-party client name.
The demo library held the only unredacted copy outside git history. Deleted and replaced with the
masked version; the mask was verified by profiling ink rows against the box rectangles (9-12 px
clearance, all four boxes decode to exactly 1 distinct grey).

STILL OPEN, filed separately: the unredacted blob remains reachable in git history via
'git show 33e66b2:docs/media/app-shift.png' on this PUBLIC repo.
<!-- SECTION:NOTES:END -->
