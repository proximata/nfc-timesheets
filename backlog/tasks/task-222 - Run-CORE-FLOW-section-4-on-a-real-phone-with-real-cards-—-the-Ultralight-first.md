---
id: TASK-222
title: Run CORE-FLOW section 4 on a real phone with real cards — the Ultralight first
status: To Do
assignee: []
created_date: '2026-08-20 22:46'
updated_date: '2026-08-21 13:04'
labels:
  - android
  - nfc
  - field
  - owner-only
dependencies: []
priority: high
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE ONLY THING LEFT THAT NO CODE CAN CLOSE. Five of the six things the owner needs are now proven against production (ops/prove-live.sh, 75 assertions, and 14 of them shown RED first). The sixth is a card in a hand, and every write assertion in this repo is against a stubbed card in android/checks/fake/.

WHY THE ULTRALIGHT IS STEP 1 AND NOT A FOOTNOTE. The refusal that protects a card from being written half-way comes from ONE number: what Ndef.getMaxSize() reports. Every check here feeds that number to a fake card, so all of them assume the platform tells the truth. A real NTAG213 has 180 bytes of memory and should report 137 as its NDEF capacity. If a phone or a card reports the raw 180 instead, the gate opens for a 64-byte message on a card that cannot hold it, and the result is a card holding neither the old content nor the new. The foreign Mifare Ultralight already mounted at HOIV holds 46 bytes and is the only instrument in the building that can answer this, because it is the only card whose real capacity is below our message size.

CARRY: android/dist/nfc-timesheets-0.4.1-6-release.apk (adb install -r, NEVER uninstall — it wipes the worker's login; the certs match, prove-live section 9 checks it every run), two blank NTAG213, the foreign Ultralight, and a Betreiber-Code issued from the admin panel before leaving. Without a code the write screen reads no card at all.

THE SCRIPT IS backlog/docs/CORE-FLOW.md section 4. Do not improvise around it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Step 1: the 46-byte Ultralight is REFUSED with 'NICHT beschrieben. Dieser Tag fasst nur 46 Byte, gebraucht werden 64'. If it says 'Geschrieben und geprueft', the whole test STOPS and nothing else is written.
- [ ] #2 Step 2: a blank NTAG213 writes and reports 'Geschrieben und geprueft' — and the byte figures it prints are recorded verbatim, because '64 von 137 Byte' is the answer to step 1's question and '64 von 180' is a defect.
- [ ] #3 Step 3: that same card, presented again while the screen offers a fresh id, is REFUSED as already carrying an ID — the TASK-220 guard, on real hardware for the first time.
- [ ] #4 Step 4: the report lands by itself — 'An das Buero gemeldet' — and the card shows up in the admin panel's Unzugeordnete Tags with the operator's name.
- [ ] #5 Step 6: after the office resolves it, a tap opens a shift and a SECOND tap closes it. No in-app button is used, because there is none.
- [ ] #6 The existing HOIV wall tag still opens and closes a shift, untouched by the visit.
- [ ] #7 Every card written is either mounted or binned — no card is left in a pocket in an unknown state.
- [ ] #8 Step 7: a card the office has NOT resolved opens NO shift and shows 'Dieser Tag ist noch keinem Objekt zugeordnet. Bitte bei der Verwaltung melden.'
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
STILL THE OWNER'S, AND STILL THE LOAD-BEARING UNKNOWN. Verdict pass 2026-08-21: no NFC card has ever been written by this code; every write assertion is against a stubbed FakeCard, and the only Android this project has ever run on is an emulator (sdk_gphone64_arm64), which has no NFC radio at all.

ONE THING NARROWED, and it was on the 'unknowable' list. 'adb shell pm get-app-links io.github.qwadratic.NFCTimeSheets' on the emulator reports 'timesheets.exe.xyz: verified'. App Link verification is a network fetch of assetlinks.json plus a signature comparison against the installed APK — neither is hardware-dependent. So the association file and the shipped signer (6C:78:...:2C:42:99:6C) demonstrably agree. What remains phone-specific is only whether a given OEM build performs verification, and when.

STEP 1 IS STILL THE ULTRALIGHT REFUSAL, and it is step 1 for the reason CORE-FLOW § 4 gives: if it WRITES, every card written after it is suspect. It also settles whether a real NTAG213 reports maxSize 137 or the raw 180.
<!-- SECTION:NOTES:END -->
