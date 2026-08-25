---
id: TASK-249
title: >-
  Sign in on a REAL iPhone through both new doors before the Apple-free build
  reaches TestFlight
status: To Do
assignee: []
created_date: '2026-08-24 13:49'
updated_date: '2026-08-25 08:43'
labels:
  - ios
  - release
dependencies: []
priority: high
ordinal: 167000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GATE, not a nicety. Commit 1417464 deletes the ONLY door currently shipping to workers
(SignInWithAppleButton) and replaces it with two doors NO ONE HAS EVER TAPPED on hardware.

WHAT IS PROVEN (measured this run, do not re-do):
  ./NFCTimeSheets/checks/run.sh              9/9 + localisation-check, 180 catalogue keys
  mutation-proved: reverting isRetryable makes tag-link-check AND materials-check go RED
  xcodebuild Release, generic/platform=iOS, CODE_SIGNING_ALLOWED=NO  -> BUILD SUCCEEDED
  the server side of both doors, live on schimmer-glanz.exe.xyz:
    POST /auth/sms/request unregistered E.164 -> 404 {"error":"unknown_phone"}
    POST /auth/sms/request garbage            -> 422 {"error":"invalid_phone","field":"phone"}
    4th request inside 5 min from one address -> 429 too_many_attempts + retry-after
    POST /auth/code bad code                  -> 401 invalid_code
    POST /auth/apple                          -> 401 invalid_token (route KEPT, decision-50 §3)

WHAT IS NOT PROVEN, AND CANNOT BE BY ANY CHECK IN THIS REPO:
  - No simulator and no device has ever RENDERED the new SignInView. checks/run.sh cats four
    files into a plain 
[1;38;5;196mWelcome to Swift![0m

[1mSubcommands:[0m

  [1mswift build[0m      Build Swift packages
  [1mswift package[0m    Create and work on packages
  [1mswift run[0m        Run a program from a package
  [1mswift test[0m       Run package tests
  [1mswift repl[0m       Experiment with Swift code interactively

  Use [1m`swift --version`[0m for Swift version information.

  Use [1m`swift --help`[0m for descriptions of available options and flags.

  Use [1m`swift help <subcommand>`[0m for more information about a subcommand. process; it has no UIKit, no SwiftUI and no window.
  - No real SMS has ever been received by a real handset from this build. Production has
    0 workers and 0 phone_identities rows, so every live probe this run made was necessarily
    an unregistered number and necessarily a 404 — the 202-and-a-text path is UNEXERCISED.
  - VoiceOver on the new Form-based two-section screen is unmeasured.
  - The 503 sms_not_configured copy ('...Bitte den Zugangscode verwenden.') has never been
    seen on screen. It is the ONLY thing standing between a worker and a dead end on a box
    with Twilio off, because iOS deliberately has NO /auth/capabilities gate (decision-50 §1).

ORDER (design's own, and it is the delivery risk that matters): server -> web -> iOS.
Server and web are DEPLOYED. iOS is not, and must not be until this passes.

DO NOT bump CURRENT_PROJECT_VERSION from an agent — project.pbxproj is the owner's, by hand.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A real iPhone signs in via phone number -> SMS -> 6 digits, against a worker with a Login-Nummer set from /workers/, and lands on the shift screen
- [ ] #2 The same phone signs in via a pasted admin-issued enrolment code, from the same screen, with no relaunch
- [ ] #3 An unregistered number shows 'Diese Nummer ist nicht hinterlegt...' on the phone field, and a wrong OTP shows 'Der Code stimmt nicht oder ist abgelaufen.' on the code field — two different sentences, verified visually
- [ ] #4 'Andere Nummer verwenden' returns to phone entry and clears the code field
- [ ] #5 sms_deliveries shows the row, status sent, and the handset actually received the text
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 16:14
---
Same session also found and fixed a second, unrelated iOS blocker in this area: CoreNFC was SIGABRTing (__CRASHING_DUE_TO_PRIVACY_VIOLATION__) on any tag write because Info.plist had no NFCReaderUsageDescription key at all — commit 6c89860, confirmed present in a real Release build's Info.plist post-build. Device test for THIS task should now also exercise a tag write, not just sign-in, since both were broken.
---

created: 2026-08-25 08:43
---
Real progress via XCUITest (first-ever render+interaction, not just source read):

PROVEN on a real Simulator against real production (schimmer-glanz.exe.xyz):
- SignInView renders correctly, no crash, all doors present (phone+OTP, enrolment code, Write a tag, Test a tag)
- AC3 BOTH halves: unregistered phone -> "This number isn't on file..." / wrong enrolment code -> "Code not accepted..." -- confirmed as two DIFFERENT sentences, live network round-trip
- AC1/AC2 proxy: a real admin-issued enrolment code (worker 116, throwaway) signed in and left the sign-in screen -- worker+session then hard-deleted from prod, code is now spent and can't be reused
- Operator "Write a tag" gate copy renders correctly and its operator-code field accepts real typed input via XCUITest

4 of these are now permanent tests in NFCTimeSheetsUITests.swift (commit a72e01c), safe to rerun anytime (no cost, no data writes for the phone/code-mismatch cases).

STILL NOT PROVEN: the real SMS round-trip (AC1's SMS half landing on the shift screen, AC5 sms_deliveries + a handset actually receiving the text -- needs either the owner's own phone or an explicitly consented number, since it spends real Twilio budget and I won't send an unconsented text. VoiceOver still unmeasured.

Note for whoever reads this: manual coordinate-based simulator automation (cliclick) was unreliable for SwiftUI TextField focus specifically (worked for buttons/navigation, not text input) -- XCUITest's accessibility-based queries are the right tool and worked first try.
EOF
)
---
<!-- COMMENTS:END -->
