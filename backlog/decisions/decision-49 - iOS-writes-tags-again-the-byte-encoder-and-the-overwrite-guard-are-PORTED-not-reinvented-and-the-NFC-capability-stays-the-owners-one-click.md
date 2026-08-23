---
id: decision-49
title: >-
  iOS writes tags again: the byte encoder and the overwrite guard are PORTED not
  reinvented, and the NFC capability stays the owner's one click
date: '2026-08-23 20:26'
status: accepted
---
iOS was dropped in favour of Android-only. **That is reversed for exactly two jobs** — writing
a tag, and an operator proving one in the field (decision-47's test scan). Nothing else about
the iOS app changes: the cleaner's tap, `TagLink.locationId(from:)`, `TapInbox`, `Sync` and the
Sign-in-with-Apple path are untouched by this record, and no line of this work is allowed onto
the clock-in path.

Amends nothing. Reuses decision-15 (tags stay UNLOCKED), decision-21 (the UUID, never the
slug), decision-44 (no serial travels TOWARDS the server), decision-45 (operator identity is
its own cookie) and decision-47 (a zone is not a clock-in target until an operator test-scans
its card). Supersedes nothing.

## Context

The Android app already does this job and has done it in the field: `core/NdefTag.kt` mints
the bytes, `core/WriteGuard.kt` decides whether a card may be destroyed, `nfc/TagWriter.kt`
runs the five-step order, `nfc/WriteTagActivity.kt` and `nfc/VerifyZoneActivity.kt` are the
two screens. Every one of those files carries a scar in its header — the 46-byte tag that
could not hold a 64-byte message, the `?l=+<uuid>` trap, and TASK-220, where a card already
screwed to a wall was silently overwritten and the screen said *„Geschrieben und geprueft."*

So this is a PORT, and the word is meant literally. The parts that decide are copied clause
for clause; only the parts that touch the platform are rewritten.

## 1. Zero new server endpoints — CONFIRMED, not assumed

Read this session, in full: `server/routes/operator.js`, `server/routes/auth.js`,
`server/routes/admin.js`'s export table, `server/server.js`'s auth kinds.

| the phone needs | route | auth | exists |
| --- | --- | --- | --- |
| redeem an operator code | `POST /auth/operator-code` | `app` | ✓ |
| end that session | `POST /auth/operator-logout` | `operator` | ✓ |
| report a written card | `POST /operator/tags` | `operator` | ✓ |
| the zone worklist + serials | `GET /operator/zones` | `operator` | ✓ |
| the test scan | `POST /operator/zones/:id/verify` | `operator` | ✓ |

Every one is plain JSON over HTTPS behind `X-App-Key` plus a cookie. Nothing in the request or
response shape is Android-specific — no `User-Agent` test, no platform field, no build gate.
**The iOS client is a second caller of an unchanged contract.**

**The `/admin/tags` resolve routes are NOT for the operator's phone, and must never be called
from it.** Two exist, both `auth: "admin"`:
`POST /admin/tags/:id/resolve-zone` and `POST /admin/tags/:id/resolve-existing-zone`.
`POST /admin/tags/:id/resolve-building` is DELETED (decision-47) and stays deleted.
Resolving a reported tag into a real place is the web admin's job — `routes/operator.js`'s own
header says so: the report "LANDS UNBOUND… Turning it into one of those is the admin's job."
An operator session cannot reach an admin route and no code in this work may try.

The structural invariant survives untouched: **no route reachable with `ts_operator` opens or
closes a shift.** This work adds a caller, not a route, so there is nothing new to weaken.

## 2. The Swift file layout

New files only. The app target uses `fileSystemSynchronizedGroups`, so a new `.swift` file
needs **no `project.pbxproj` edit** — the same property `docs/LIVE-ACTIVITY-SETUP.md` already
relies on and already verified against the real project.

Under `NFCTimeSheets/NFCTimeSheets/`:

| file | what it is | port of |
| --- | --- | --- |
| `NdefTag.swift` | pure Foundation. The bytes, and the three refusals. | `core/NdefTag.kt` |
| `WriteGuard.swift` | pure Foundation. Blank / Foreign / Ours, and the six-character token. | `core/WriteGuard.kt` |
| `EnrolmentCode.swift` | pure Foundation. Crockford base32 normaliser, mirrors `server/lib/enrolment.js`. | `core/EnrolmentCode.kt` |
| `OperatorAPI.swift` | the operator wire contract + its OWN `URLSession` and cookie jar. | `net/Api.kt` (operator half) + `core/SessionCookie.kt` |
| `OperatorSession.swift` | `@Observable`. Signed-in / signed-out, code redemption, Keychain-backed token. | `net/CookieJar.kt` + the enrol half of the two activities |
| `OperatorZoneCache.swift` | the last `GET /operator/zones` envelope, raw bytes. | `nfc/OperatorZoneCache.kt` |
| `PendingTagReport.swift` | a verified write the server has not been told about yet. | `nfc/PendingTagReport.kt` |
| `TagWriter.swift` | CoreNFC. `NFCTagReaderSession`, the five-step order, `Outcome`. | `nfc/TagWriter.kt` |
| `TagReaderProbe.swift` | CoreNFC read-only: a card → a place uuid, for the test scan. | the `readUri` half of `nfc/VerifyZoneActivity.kt` |
| `OperatorScreen.swift` | SwiftUI shell: sign in, then Write or Verify. | — (iOS-only; Android uses two activities) |
| `WriteTagScreen.swift` | SwiftUI. The write screen and the overwrite confirmation box. | `nfc/WriteTagActivity.kt` |
| `VerifyZoneScreen.swift` | SwiftUI. Pick the zone FIRST, then scan. | `nfc/VerifyZoneActivity.kt` |

One additive line in `TagLink.swift`: a `static func uriFor(_ locationId: String?) -> URL?`,
the inverse of `locationId(from:)`, which iOS has never had. `locationId(from:)` itself is not
touched — the tap path reads the same bytes it read yesterday.

Two additive entry points in `ContentView.swift`, and nothing else in that file:
a row in `SettingsView` and a quiet link on `SignInView`. **Both are needed**: an operator's
phone may hold no worker session at all, and `ContentView` renders `SignInView` and nothing
else in that state, so a Settings-only entry would be unreachable for exactly the person who
needs it.

Checks, under `NFCTimeSheets/checks/`, wired into `checks/run.sh` with their dependency sets:
`ndef-tag-check.swift`, `write-guard-check.swift`, `operator-session-check.swift`.

## 3. What is ported byte for byte, and the ONE thing iOS cannot do

Copied without reinterpretation:

- the record: `D1 01 <len> 55 04 <uri minus "https://">`, one short Well-Known `U` record,
  MB and ME on the same header byte, no ID field, no chunking, nothing trailing;
- `uriFrom` stays STRICT, including `message.count != 4 + payloadLength → nil`;
- the five decode prefixes and no more — an unknown abbreviation is refused, never guessed;
- **capacity is a refusal, not a warning**, and it is decided BEFORE any write;
- **the bytes go back through the parser before they go onto the card**: the URI is minted
  inside `plan` from `TagLink.uriFor`, never passed in, and `TagLink.locationId(from:)` of the
  bytes must return the same uuid or the plan is `.badId`;
- the order: read facts → `plan()` → **re-read what the card already says** → `decide()` →
  write → **re-read and compare** → only then report;
- both re-reads are LIVE. There is no cache on iOS to reach for and there must never be one;
- the guard's decision entire: `Ours` is refused unless the operator types back the last six
  characters of the id ON THE CARD; the confirmation is bound to that one id; the retry path
  (same id over the same card) still proceeds; `confirms` forgives case and space and nothing
  else. The screen may differ. The decision may not.
- `writeLock` is NEVER called (decision-15). It exists on `NFCNDEFTag` and is forbidden; the
  check greps the iOS sources for it.

**The divergence, stated loudly because it is the safety-critical one.** Android compares raw
bytes: `NdefMessage.toByteArray()`. **`NFCNDEFMessage` has no serialisation accessor at all** —
it offers `records`, `length` and `NFCNDEFMessage(data:)`, and nothing that hands the bytes
back. Verified against the iPhoneOS 26.5 SDK header this session. So iOS cannot literally
diff the array it wrote against the array it read.

What it does instead, and why it is equivalent:

1. `NFCNDEFMessage(data: write.bytes)` must be **non-nil** — the platform parser gets the last
   word on validity, exactly as on Android;
2. that message's `.length` must equal `write.bytes.count`;
3. the read-back message must have **exactly one** record, `typeNameFormat == .nfcWellKnown`,
   `type == 0x55`, an EMPTY `identifier`, and a payload byte-identical to ours;
4. the read-back is **re-serialised by `NdefTag.swift`'s own pure encoder** and the result
   compared byte for byte against `write.bytes`;
5. and `TagLink.locationId(from: NdefTag.uriFrom(bytes))` must still be the id we wrote.

Every failure this guards against — a truncated write, a partial message, a different payload,
a second record, a foreign card that happens to parse — changes one of those five. The single
thing it cannot distinguish is a card holding OUR content in long form rather than short: same
records, same URI, same tap behaviour, so not a correctness failure for this product. It is
named here rather than left to be discovered.

## 4. The operator session is a SEPARATE jar, and that is structural

Android keeps `ts_worker` and `ts_operator` in separate stores on separate requests so that
"the operator's phone accidentally clocked somebody in" is not a bug that can be written.
iOS must reproduce that property, and the naïve route breaks it twice:

- `URLSession.shared`'s cookie jar would carry `ts_operator` onto every worker request;
- `Auth.clearLocalSession()` deletes **every** cookie for `API.base`, so a worker signing out
  would silently end an operator's session too;
- `API.swift`'s response choke point posts `.sessionRejected` on **any** 401, so an expired
  operator session would sign the WORKER out of a session that never failed.

So `OperatorAPI` gets its own `URLSession` with `httpShouldSetCookies = false` and
`httpCookieAcceptPolicy = .never`, sets `Cookie: ts_operator=<token>` by hand from its own
store, and **never posts `.sessionRejected`**. Two sessions, two jars, no request that carries
both — the same property Android gets, obtained the same way.

The token lives in the **Keychain**, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, not in
`UserDefaults`: it is a bearer credential, and `UserDefaults` is in the device backup.
`Auth.swift`'s own note ("NOT the Keychain: none of this is a secret") is about a worker id and
a name, and does not apply to a session token.

`Set-Cookie` handling is a straight port of `core/SessionCookie.kt`: `Store` / `Clear` /
`Ignore`, last mention wins, `Max-Age=0` looked for in the ATTRIBUTES only and never in the
opaque token, and **silence means keep** — treating an ordinary 200 as a logout would sign an
operator out mid-visit.

decision-44 survives byte for byte: `tag_serial` travels OUTWARDS on `GET /operator/zones`, is
matched against a scanned UID **client-side**, and what is posted is the resolved zone uuid.
No serial is ever put in a request body.

## 5. THE HARD BLOCKER: the entitlement is the owner's, and nobody else touches it

Writing a tag needs a foreground `NFCTagReaderSession`. That needs
`com.apple.developer.nfc.readersession.formats = ["TAG"]` in
`NFCTimeSheets/NFCTimeSheets.entitlements`, which needs the **Near Field Communication Tag
Reading** capability ticked in Xcode's Signing & Capabilities pane — which is simultaneously an
App ID change on the Apple Developer portal and a new provisioning profile. Xcode's automatic
signing does all three atomically, as one owner action.

The capability was **deliberately removed once before**, after App Store rejection 90778
(`NDEF` is not accepted against the iOS 26 SDK; only `TAG` is). The entitlements file says so
in a comment written before this work existed. It is very likely OFF on the portal right now.

**This run does not add the key.** Editing the entitlement without the paired
capability/portal/profile change is worse than leaving it alone, because automatic signing can
fight or strip it on the owner's next open, and the failure looks like a signing problem rather
than a missing tick. `project.pbxproj`, `IPHONEOS_DEPLOYMENT_TARGET` and
`CURRENT_PROJECT_VERSION` are likewise untouched. The click path is written down instead:
**`docs/NFC-WRITE-SETUP.md`**, in the idiom of the existing `docs/LIVE-ACTIVITY-SETUP.md` —
which does exist and is the precedent this file mirrors.

`NFCNDEFReaderSession` is not a workaround and is not used anywhere. The test scan needs a
foreground read too, and the only other way to read a card on iOS is the background tap, which
opens a shift. **An operator proving a card must never be able to file hours by doing it.**

### Graceful degradation, exactly

Two runtime signals, because iOS offers no third — there is no `SecTask` on the iOS SDK, so an
app cannot read its own entitlements before trying.

```
NFCTagReaderSession.readingAvailable == false      → this iPhone has no NFC reader
        ↓ true
start session → tagReaderSession(_:didInvalidateWithError:)
        with NFCReaderError.readerErrorSecurityViolation
        ("Missing required entitlement and/or privacy settings", NFCError.h)
                                                   → the capability is not on this build
```

The screen renders, the sentence is plain, nothing crashes and nothing is written. The literal
strings, English keys with German translations in `Localizable.xcstrings`:

- no hardware —
  `"This iPhone can't read NFC tags."`
- entitlement missing —
  `"Tag writing isn't switched on in this build. Ask the developer to enable the NFC Tag Reading capability in Xcode — see docs/NFC-WRITE-SETUP.md."`

The entitlement verdict is held **in memory for the life of the screen only**, never persisted:
a build that gains the capability must work on its first launch, without anyone clearing a
flag. The cost is one tap per launch to rediscover it, which is the honest trade.

Everything else on the operator surface still works with the capability off — signing in with
an operator code, fetching the worklist, reading the cache offline. Only the two buttons that
need a radio say they cannot.

## 6. What must not regress, and how it is proved

- **The tap path is not touched.** `TagLink.locationId(from:)`, `TapInbox`, `Sync`,
  `ShiftSignalCenter` and every `/shifts/*` call are unchanged. Clock-in is never blocked by
  anything in this work, including a missing entitlement.
- **Sign in with Apple does not regress.** `Auth.swift` gains nothing and loses nothing; the
  operator session lives outside its cookie handling entirely, which is why `signOut()` needs
  no edit.
- **The Android enrolment-code path does not regress.** No Kotlin is touched.
- German is mandatory: `checks/localisation-check.swift` fails on any key without a
  `state: "translated"` German string, so every new sentence ships translated or the checks go
  red. House vocabulary: `Objekt`, never `Gebäude`.
- Every new check must be seen RED before it is believed: seed the condition — a byte flipped
  in the expected array, a `writeLock` call added, a confirmation token off by one character —
  watch it fail, then restore.
- `xcodebuild … CODE_SIGNING_ALLOWED=NO` is the honest compile gate, as it was for ActivityKit.
  A **signing** failure is an owner-side gap, not a failure of this work; a **compile** failure
  is ours.

## Consequences

- A second surface can now write a physical card. Both are held to the same encoder and the
  same guard, and both are checkable on a laptop — the port is what makes that true.
- iOS stays behind Android until the owner ticks one box. Until then the code is inert and says
  so in words, which is the same bargain `NSSupportsLiveActivities` already ships under.
- Two clients now depend on `core/NdefTag.kt`'s byte layout. It is frozen: a change to the
  record shape is a change to both apps and to every card already on a wall, and it needs its
  own decision record.
- A stray background tap on a mounted card by an operator whose phone ALSO holds a worker
  session will still open a shift, because iOS background tag reading cannot be switched off.
  An active reader session pre-empts it while the operator screen is scanning; off that screen
  it is unmitigated. Named, not solved.
