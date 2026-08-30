---
id: TASK-321
title: >-
  RELEASE BLOCKER: both phones reject the server's 5-digit enrolment code
  (decision-63) - nobody can sign in
status: In Progress
assignee: []
created_date: '2026-08-29 23:03'
updated_date: '2026-08-30 05:03'
labels:
  - blocker
  - release
  - android
  - ios
dependencies: []
priority: high
ordinal: 239000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-63 (003d2e4) cut the enrolment code to 5 DIGITS server-side. Neither client followed, so the single live sign-in door is closed on both platforms.

MEASURED, not inferred (runnable, at HEAD):
  node -e "import('./server/lib/enrolment.js').then(E=>console.log(E.normaliseCode('12345'), E.normaliseCode('ABCD1234')))"
    -> '12345'  (server accepts 5 digits)
    -> null     (server REJECTS the 8-char Crockford form both clients emit)
  android/.../core/EnrolmentCode.kt : LENGTH = 8, alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ
  NFCTimeSheets/.../EnrolmentCode.swift : length = 8, pattern ^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$
  -> a real 5-digit code typed into either app leaves the submit button DISABLED. No request
     is ever sent, and by design no reason is shown. It looks like a dead app.

BLAST RADIUS: sms_login and email_login are both seeded false (migrations 016, 021), so the
enrolment code is the ONLY door for a new worker AND a new operator. Existing session cookies
survive, so already-signed-in workers keep working - onboarding, re-enrolment and any
signed-out worker do not. Operator onboarding breaking also blocks decision-47 zone verification.

ALSO STALE, same cause:
  android res/values/strings.xml signin_code_hint  '8 Zeichen. ...'
  android res/values-en/strings.xml                '8 characters. ...'
  the operator helper text still says 8 Zeichen
  server/lib/enrolment.js drops the hyphen, so any UI formatting XXXX-XXXX is wrong too

GATE THAT ALREADY SEES IT: android/checks/run.sh exits 1 -
  FAIL: the alphabet is 32 characters, i.e. exactly 5 bits
  FAIL: code length: server 5 vs client 8
(core-check.kt:1323,1329 read the literals straight out of server/lib/enrolment.js.)

MUST NOT REGRESS: no reason is ever shown for a rejected code (silent, one message); the client
must never be MORE permissive than the server; no entitlement/pbxproj/branding change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Android EnrolmentCode.kt mirrors server: digits only, LENGTH 5
- [x] #2 iOS EnrolmentCode.swift mirrors server: digits only, length 5
- [x] #3 signin_code_hint and the operator helper updated in de AND en on both platforms
- [x] #4 android/checks/run.sh exits 0 with no FAIL line
- [ ] #5 a server-minted 5-digit code signs in end-to-end on emulator and simulator against a loopback server
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed both platforms (commit c29b7c3): LENGTH 8->5, digits-only regex, letter-aliasing deleted, keyboard numeric, i18n updated de+en, android/checks/run.sh + new iOS enrolment-code-check.swift both OK. Independently re-verified via differential fuzz of all 3 normalise() implementations (server/kotlin/swift) on 5037 cases (37 handcrafted edge cases + 5000 random fuzz): 0 mismatches. Parity checks proven to actually catch drift (flipped server CODE_CHARS 5->6, both platform checks went red, reverted). AC5 (real device/simulator sign-in) NOT met: proven by check+compile+fuzz only, no emulator/simulator tap was driven. Left In Progress for that reason.
<!-- SECTION:NOTES:END -->
