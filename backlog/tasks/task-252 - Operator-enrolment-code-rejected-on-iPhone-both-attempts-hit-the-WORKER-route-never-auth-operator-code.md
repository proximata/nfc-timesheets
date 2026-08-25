---
id: TASK-252
title: >-
  Operator enrolment code rejected on iPhone -- both attempts hit the WORKER
  route, never /auth/operator-code
status: Wont Do
assignee: []
created_date: '2026-08-24 14:57'
updated_date: '2026-08-25 15:23'
labels:
  - ios
  - operators
  - bug
dependencies: []
references:
  - NFCTimeSheets/NFCTimeSheets/OperatorAPI.swift
  - NFCTimeSheets/NFCTimeSheets/OperatorSignInScreen.swift
priority: high
ordinal: 170000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live evidence, journalctl -u nfc-api on schimmer-glanz.exe.xyz, 2026-08-24:

  13:45:58  POST /auth/apple  401 invalid_token
  13:45:58  POST /auth/code   401 invalid_code   <- worker route
  14:49:34  POST /auth/code   401 invalid_code   <- worker route
  14:56:02  POST /auth/code   401 invalid_code   <- worker route

POST /auth/operator-code has ZERO hits in the log, ever, on this build. iOS source is
correct (OperatorAPI.swift:96 calls /auth/operator-code, byte for byte per decision-45 \u00a76)
so this is not a client wiring bug in the CURRENT tree.

Two live hypotheses, neither confirmed yet:
  A) the code was typed into the WORKER sign-in screen's enrolment-code field (present since
     decision-26, the app's most visible code box) instead of Settings -> 'Operator sign-in'
     -> code field. A worker code and an operator code are the same shape (newEnrolmentCode
     alphabet), so nothing on the code itself would tell an operator which box it belongs in.
  B) the installed TestFlight build predates OperatorSignInScreen (decision-45, commits
     ce001fc/493361b) entirely, so Settings never had an 'Operator sign-in' entry to find
     in the first place -- the worker box would then be the ONLY code field visible, and
     using it would be the only option, not a mistake. The stray POST /auth/apple call in
     the same burst is consistent with an older SignInView (pre-decision-50) still doing a
     silent Apple credential-state check on launch.

BLOCKED on one fact only the owner has: which screen was the code typed into, and/or the
build number actually running (Settings -> About, once TASK-x below ships a version label --
today there is nowhere on either app to read this without Xcode).

If (A): the fix is discoverability -- either merge the two code fields into one that tries
operator-code first then falls back to worker code (drifts server contract), or make the
Operator sign-in entry impossible to miss the first time an unrecognised code fails on the
worker screen ('Is this an operator code? Try Settings -> Operator sign-in' -- error copy,
no new route).
If (B): the fix is just shipping a build that includes decision-45, nothing to build.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed 2026-08-25, unresolved by choice, not by fix. Root cause needs one fact only the owner has (which screen the code was typed into, or the build number) and that investigation stalled. Closing rather than leaving it open indefinitely: if the underlying confusion (worker enrolment-code box vs operator sign-in box, or a stale pre-decision-45 TestFlight build) is still live, it will produce another POST /auth/code 401 burst and can be re-filed against that fresh evidence instead of this one.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 16:14
---
Root cause confirmed: SettingsView's Operator sign-in link only existed inside .eligible(worker), so an operator-only phone had no path in at all — fixed commit 9638323. Further improved commit 6c89860: Write a tag / Test a tag are now direct links on the SIGN-IN screen too (full parity with Android), and the operator-code gate moved INTO WriteTagScreen/VerifyZoneScreen themselves (mirrors WriteTagActivity.kt onResume's operatorReady refusal) — a link on the sign-in screen is reachable pre-auth, so the gate had to move with it. Still not verified on a real device; this task stays open until someone actually redeems a code there.
---
<!-- COMMENTS:END -->
