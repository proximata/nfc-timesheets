# NFC tag writing — the one thing only you can do in Xcode

Everything else for writing a tag on iPhone is committed and checkable on a laptop. This file
is the short list of clicks that no agent is allowed to make, because they edit
`NFCTimeSheets.entitlements` **together with** the App ID on the Apple Developer portal and the
provisioning profile — three things that must move as one, and only Xcode's automatic signing
moves them as one.

**The app builds, ships and behaves correctly today without doing any of this.** With the
capability off, the operator screens render, an operator can sign in with their code, the zone
worklist loads and caches, and the two buttons that need the radio say — in words, in German —
that tag writing is not switched on in this build. Nothing crashes. Nothing is written. **A
cleaner's clock-in is not affected in any way**: that path is a background tag read plus a
universal link, and it has never needed this entitlement.

Design and reasoning: `backlog/decisions/decision-49`.

---

## What already ships, with no project edit

| Piece | Where | Needs you? |
|---|---|---|
| The byte encoder and its three refusals | `NdefTag.swift` | no |
| The overwrite guard and the six-character token | `WriteGuard.swift` | no |
| Operator sign-in with an enrolment code | `OperatorSession.swift` | no |
| Zone worklist, cached for a stairwell with no signal | `OperatorZoneCache.swift` | no |
| New `.swift` files at all | the app target uses `fileSystemSynchronizedGroups` | no |
| **Actually writing a card** | needs a foreground `NFCTagReaderSession` | **YES — the step below** |
| **The operator test scan** (decision-47) | same session, same capability | **YES — same step** |

---

## The step — Near Field Communication Tag Reading

1. Xcode → project → target **NFCTimeSheets** → **Signing & Capabilities**.
2. **+ Capability** → **Near Field Communication Tag Reading**.
3. Xcode writes this into `NFCTimeSheets/NFCTimeSheets.entitlements`:

   ```xml
   <key>com.apple.developer.nfc.readersession.formats</key>
   <array>
       <string>TAG</string>
   </array>
   ```

4. **Check the array says `TAG` and only `TAG`.** If Xcode also adds `NDEF`, delete that line.
5. Build. Run on a real iPhone. Open Settings → the operator row → Write a tag.

### `NDEF` is a rejection, not a preference

App Store review answered **error 90778** to a build whose entitlement carried `NDEF`. Against
the iOS 26 SDK only `TAG` is accepted. That rejection is why this capability was removed in the
first place, and why the code uses `NFCTagReaderSession` and never `NFCNDEFReaderSession`.

### Why an agent must not just add the key

The entitlement file alone is not the capability. The same tick also:

- adds the NFC Tag Reading feature to the App ID `io.github.qwadratic.NFCTimeSheets` on the
  Apple Developer portal, and
- regenerates the provisioning profile that has to carry it.

An entitlement key with no matching App ID feature is a **signing failure**, and automatic
signing may quietly strip or fight the key the next time the project is opened. The symptom
then looks like a certificate problem rather than a missing tick, which is a bad afternoon.

`project.pbxproj`, `IPHONEOS_DEPLOYMENT_TARGET` and `CURRENT_PROJECT_VERSION` stay yours by
hand as well. Nothing in this work touches them.

---

## What you see with the capability OFF

Two runtime signals, and there is no third — iOS has no `SecTask`, so an app cannot read its
own entitlements before trying.

```
NFCTagReaderSession.readingAvailable == false
    → "This iPhone can't read NFC tags."          (no NFC hardware, or the Simulator)

session starts, then didInvalidateWithError:
    NFCReaderError.readerErrorSecurityViolation
    → "Tag writing isn't switched on in this build. Ask the developer to enable the
       NFC Tag Reading capability in Xcode — see docs/NFC-WRITE-SETUP.md."
```

The verdict is remembered for the life of the screen and **never persisted**: a build that
gains the capability works on its first launch, with nothing to reset. The price is one tap per
launch to rediscover it, which is the honest way round.

---

## Verify on hardware before you promise it to anyone

Nothing on a Mac can prove any of this. Take a phone, a blank NTAG213 and a spare card.

1. **A blank card writes.** The screen names the uuid, the byte count and the capacity.
2. **A too-small card is REFUSED before anything is written.** The card already mounted at
   HOIV holds 46 bytes and the message needs ~64 — present it and watch it refuse. This is not
   hypothetical; it is where the rule came from.
3. **A card that already holds one of our ids is REFUSED.** The screen names the id ON THE CARD
   and asks for its last six characters. Type six wrong characters: still refused. Type the six
   from the id being OFFERED (which is right there on the same screen): still refused.
4. **Confirming card A does not authorise card B.** Confirm one, then present a different
   mounted card without leaving the screen. It must refuse again.
5. **Pull the card away mid-write.** The result must be `Unverified`, never success. A card
   that may hold half a message is never reported to the server.
6. **The report is soft.** Turn off wifi and mobile data, write a card: the write still
   succeeds and says so, and the report shows as failed-and-retryable. Turn the data back on,
   tap retry.
7. **The test scan proves the right door** (decision-47). Pick a zone, scan a card mounted on a
   DIFFERENT zone: `zone_mismatch`, and nothing is stamped.
8. **An operator cannot clock in.** With only an operator session on the phone, there is no
   route to open a shift — confirm the app offers none, and confirm the server log shows no
   `POST /shifts/open` for the whole visit.

---

## What is still impossible, so nobody spends a day on it

| Wanted | Why not |
|---|---|
| Writing a tag with the app closed | Core NFC writes need a foreground session with the system sheet on screen. There is no background write on iOS, at all. |
| Comparing the written bytes to the card's raw bytes | `NFCNDEFMessage` exposes `records` and `length` and no serialisation accessor. The read-back is reconstructed and compared instead — decision-49 §3 says exactly what that can and cannot see. |
| Locking a tag read-only | Forbidden by decision-15. Tags stay unlocked as migration insurance, `writeLock` is never called, and a check greps the sources for it. |
| Stopping a stray background tap during a field visit | iOS background tag reading cannot be switched off. An active reader session pre-empts it while the operator screen is scanning; off that screen it is not mitigated. Sign the worker out of the operator's phone if this matters. |
| Resolving a reported tag into a building or zone from the phone | `/admin/tags/resolve-*` is admin-only and belongs in the web panel. The phone reports the card; a human claims it. |
