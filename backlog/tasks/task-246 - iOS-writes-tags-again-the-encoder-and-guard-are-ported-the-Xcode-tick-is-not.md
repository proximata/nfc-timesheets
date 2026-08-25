---
id: TASK-246
title: 'iOS writes tags again: the encoder and guard are ported, the Xcode tick is not'
status: In Progress
assignee: []
created_date: '2026-08-23 21:18'
updated_date: '2026-08-25 13:26'
labels:
  - ios
  - nfc
  - physical
dependencies: []
priority: high
ordinal: 164000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-49. iOS regained tag WRITING and the operator test scan, as a faithful port of the Android core, not a reinvention. Ported: NdefTag.swift (byte encoder + the three refusals), WriteGuard.swift (TASK-220's overwrite guard), TagWriter.swift (the five-step order: read facts -> plan off-device -> LIVE re-read -> decide -> write -> LIVE re-read and compare), TagReaderProbe.swift, OperatorSession/OperatorAPI/EnrolmentCode + the sign-in, write and verify screens.

ZERO server change was needed and none was made: server/ is byte-identical to b8c48d1. The three operator routes were already generic (POST /operator/tags {id}, GET /operator/zones, POST /operator/zones/:id/verify, all auth:operator) and the iOS client was written to that existing contract.

WHAT REMAINS, and it is not code: the 'Near Field Communication Tag Reading' capability is not ticked in the Xcode project, so no card can actually be written or test-scanned yet. Click path: docs/NFC-WRITE-SETUP.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The byte encoder is byte-identical to Android's
- [x] #2 The TASK-220 overwrite guard refuses a mounted card
- [x] #3 The build degrades gracefully with the capability off
- [x] #4 project.pbxproj and the entitlements file are untouched
- [x] #5 The tap/clock-in path is untouched
- [ ] #6 OWNER: the NFC capability is ticked in Xcode
- [ ] #7 OWNER: the 8-item hardware list in docs/NFC-WRITE-SETUP.md passes on a real iPhone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Owner, in Xcode, once:
1. target NFCTimeSheets -> Signing & Capabilities -> + Capability -> Near Field Communication Tag Reading
2. confirm the entitlement array reads TAG and ONLY TAG - delete NDEF if Xcode adds it (NDEF = App Store error 90778, the rejection that removed this capability the first time)
3. build to a real iPhone, then walk the 8-item hardware list in docs/NFC-WRITE-SETUP.md
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFY PHASE, 2026-08-23. Every claim below was re-derived this session, not trusted.

AC1 BYTE ENCODER — proven three ways, not by reading the code.
An independent encoder was written in Python from the NFC Forum RTD-URI record layout
(not transcribed from either implementation), and used to derive vectors by arithmetic.
The real Swift NdefTag.plan()/message() was then run and compared:

  uuid 3f2504e0-4f89-11d3-9a0c-0305e82c3301 (+ an UPPERCASE and an all-zero vector)
  -> d1 01 40 55 04 "schimmer-glanz.exe.xyz/t?l=<uuid>"   68 bytes   MATCH

Then the decisive cross-implementation check: the Swift encoder was fed the exact input
android/checks/core-check.kt pins by hand (host timesheets.exe.xyz, HOIV_LOCATION
c3c37d4a-ca0a-42c5-b248-9704b9907ec7) and landed on Android's own hand-typed numbers —

  d1 01 3c 55 04 ...   64 bytes, payload 0x3c

i.e. byte-identical to the card physically mounted at HOIV. All five header refusals
(ME cleared, CF set, IL set, SR cleared, unknown prefix), trailing-byte, truncation,
Text-record and the five unencodable inputs match Android's list. No Kotlin toolchain
exists on this machine, so parity is proven by landing on Android's pinned literals
rather than by executing NdefTag.kt.

AC2/AC3 THE CHECKS ARE NOT VACUOUS — seeded RED first, three times, independently of
what the implementing run claimed:
  - decide() forced to always .proceed (this IS TASK-220)
        -> FAIL: a card holding one of our ids, offered a DIFFERENT id, MUST be refused
  - record type 0x55 'U' -> 0x54 'T' (a card that can never wake a closed app)
        -> FAIL: type is 'U', never 'T'
  - the capacity refusal deleted (the real 46-byte HOIV incident)
        -> FAIL: a 46-byte tag (the HOIV case) must be refused as tooSmall, not written
Each reverted and re-run green; no sabotage was committed (git status clean of Swift).

Degradation verified against the iPhoneOS26.5 SDK itself: NFCError.h documents
NFCReaderErrorSecurityViolation as "Missing required entitlement and/or privacy settings
from the client app" — the exact entitlement gate. Both degraded strings carry German
translations at state 'translated'. NFCNDEFReaderSession appears nowhere in source (only
in comments), so the 90778 shape is avoided.

AC4 THE TWO FORBIDDEN FILES — the strongest available proof, identical blob SHAs at
baseline, HEAD and worktree:
  project.pbxproj                0b635cb0ec5b5b1739f8c7351f8f913dcfa96a86
  NFCTimeSheets.entitlements     9ec9f71f5dd7275f66db5b661c93522e0b4d70ee

AC5 CLOCK-IN UNTOUCHED. TapInbox/Sync/API/Auth/ShiftScreen/Branding: zero diff.
TagLink.swift is additive only — lines 1-50 (host, path, normalizedUUID, locationId)
hash identically before and after; only uriFor() was appended. onOpenURL and
onContinueUserActivity are byte-identical when extracted by content. ContentView's
handleTap region (lines 300-470) is identical; the only edit is a Settings row at 715.

HONESTY CHECK — the build is better than expected:
  xcodebuild -sdk iphoneos -configuration Release build  ->  ** BUILD SUCCEEDED **
It genuinely code-signed (Apple Development: Ivan Kotelnikov). CoreNFC autolinked with
no project edit (otool -L confirms). The signed binary contains NO
nfc.readersession.formats key — the capability is provably OFF, as expected.

FINDING THAT CHANGES THE HANDOVER: the brief assumed the Apple Developer portal
capability was off. It is NOT. The provisioning profile Xcode signs with
(fc12518e, created 2026-07-28, expires 2027-07-28) already grants
nfc.readersession.formats = [NDEF, TAG, PACE]. The portal half is DONE; only the local
entitlements key is missing. Measured with the key injected via a throwaway file (the
real file never touched): the Release device build SUCCEEDS and embeds it. So a wrong
NDEF will not fail locally — it returns as App Store 90778 later, which makes "TAG and
only TAG" the step that matters. docs/NFC-WRITE-SETUP.md corrected in commit b6b434c.

SCOPE: server/, web/ and package.json are byte-identical to b8c48d1 — no endpoint was
needed and none was added; the iOS client was written to the existing contract
(POST /operator/tags {id}, POST /operator/zones/:id/verify {place_uuid} — verified
field-for-field against server/routes/operator.js). No npm dependency added.
decision-15 held: writeLock is never called, only named in comments as forbidden.
decision-44 held: outbound bodies carry code / id / place_uuid only, never a serial.
No operator-path file references /shifts at all.
Production re-read and unchanged: locations=0 zones=0 workers=0 clients=0 admins=1
shifts=0 reported_tags=0.
NFCTimeSheets/checks/run.sh: all 9 checks OK (171 localisation keys, all German).

NOT DONE, and not doable from here: no device install, no TestFlight, no submission.
Nothing about writing or test-scanning a card is proven on hardware until AC6 is ticked.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-25 13:26
---
2026 follow-up: owner added NDEF back to NFCTimeSheets.entitlements locally (uncommitted) while testing read+write, hit an error, and asked to fix it by raising IPHONEOS_DEPLOYMENT_TARGET. Recording why that path was declined, so the next reader doesn't retry it: (1) App Store 90778 is an SDK-build-time entitlement-content rejection ('NDEF' in the readersession.formats array, against the iOS 26 SDK), not a runtime NFC-API availability gate -- NFCNDEFReaderSession read+write has existed since iOS 13, so no deployment-target bump changes what error 90778 checks. (2) Read+write both already work via NFCTagReaderSession (TAG format) + the ported byte encoder (NdefTag.swift/WriteGuard.swift, AC1-5 here) -- TAG-only was always sufficient, NDEF was never required. (3) project.pbxproj (IPHONEOS_DEPLOYMENT_TARGET) and the entitlements file are both owner-only per decision-49/AC4; an agent won't touch either regardless. The actual fix is unchanged from this task's own plan: delete the NDEF line Xcode added, confirm the array reads TAG only, then AC6/AC7.
---
<!-- COMMENTS:END -->
