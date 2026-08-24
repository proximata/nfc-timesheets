---
id: TASK-248
title: >-
  The iOS demo recording pipeline can no longer sign in: DemoHooks' sign-in hook
  was deleted with Sign in with Apple
status: To Do
assignee: []
created_date: '2026-08-24 13:48'
labels:
  - ios
  - demo
dependencies: []
priority: medium
ordinal: 166000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Consequence of commit 1417464 (decision-50). Stated by the implementing agent, confirmed here
by reading the files.

MEASURED:
  NFCTimeSheets/NFCTimeSheets/DemoHooks.swift — Session.demoSignIn(identityToken:nonce:) is
  GONE. The file's own header (lines 33-34) says so and names the two callers left behind.
  demo/record-ios.mjs line 180  -> relaunch("--ts-demo-signin", identity.identity_token,
                                            "--ts-demo-nonce", identity.nonce)
  demo/ios-setup.sh line 116    -> xcrun simctl launch ... --ts-demo-signin $token --ts-demo-nonce $nonce
  demo/ios-setup.sh line 80     -> greps the built binary for TSDemoHooksArmed|ts-demo-signin|
                                   ts-demo-tap|'NFC is MOCKED'. TSDemoHooksArmed still exists,
                                   so this guard still passes — it will NOT catch the break.

So the flags are accepted and ignored: the Simulator launches SIGNED OUT and every subsequent
step of the recording is against the sign-in screen. Silent, and the arming guard cannot see it.

THE FIX, per design.ios's own wording: repoint the DEBUG hook at the ENROLMENT CODE.
POST /auth/code works in the Simulator (no Apple entitlement needed), which is the whole
reason the Apple hook existed. That means a --ts-demo-code flag, DemoHooks calling
Session.signInWithCode, demo/demo-server.mjs minting a code instead of an identity token, and
record-ios.mjs passing it.

NOT URGENT: no product behaviour depends on this and the docs/media/ recordings already
rendered are unaffected. It bites the next person who tries to re-record the iOS demo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 demo/record-ios.mjs produces a signed-in Simulator again, via the enrolment code and not an Apple identity token
- [ ] #2 demo/ios-setup.sh's binary-strings guard greps for the NEW flag name, so a future deletion of the hook fails the guard instead of passing it
<!-- AC:END -->
