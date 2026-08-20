---
id: TASK-220
title: Tag beschreiben silently overwrites a live mounted card
status: Done
assignee: []
created_date: '2026-08-20 19:53'
updated_date: '2026-08-20 20:51'
labels:
  - android
  - nfc
  - safety
dependencies: []
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Driven off-device against the real TagWriter with a fake card pre-loaded with the live HOIV tag bytes: presenting an already-written, mounted, working card to WriteTagActivity overwrites it with the fresh unbound uuid the screen is offering, and reports 'Geschrieben und geprueft.' Nothing compares the card's existing content to anything before writing.

Trace: Ndef.get -> connect -> getMaxSize -> isWritable -> writeNdefMessage[<fresh uuid>] -> getNdefMessage -> close. card now holds 11111111-2222-4333-8444-555555555599 where it held c3c37d4a-ca0a-42c5-b248-9704b9907ec7.

Blast radius: that door returns 422 for every worker until an admin re-resolves the new uuid, and the operator has no idea - the screen said success. The button is on the Erfassen screen, reachable by ANY app user; the operator session only gates the report, never the write.

Not fixed in the verdict pass on purpose: TagWriter is the one class that changes a physical object, there is no hardware to verify a change against, and the owner is about to field-test. backlog/docs/CORE-FLOW.md section 4 works around it in the phone script instead.

Acceptance: presenting a card whose current content parses (via TagLink) to a location id DIFFERENT from the one being offered produces a new Refused outcome and NO writeNdefMessage in checks/fake TagBus.calls; re-presenting a card holding the SAME id still writes (the failed-verify retry path must survive); a blank or foreign-content card is unaffected. German string for the refusal. Must not regress: android/checks/run.sh, checks/release-artefact.sh.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A card already carrying a DIFFERENT known location id is refused with no write in the observed call log
- [x] #2 Re-presenting a card holding the SAME offered id still writes (failed-verify retry survives)
- [x] #3 Blank and foreign-content cards behave exactly as today
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed at 2b6c6e6 (guard), 9389d7c (the check that names its deletion), 9822f64 (signed build).

WHAT CHANGED
- core/WriteGuard.kt, new and pure: classify what the card ALREADY holds (Blank / Ours /
  Foreign), decide whether it may be written, and mint the six-character token that
  authorises destroying one of ours. A confirmation is bound to ONE id.
- nfc/TagWriter.kt: one new step, a LIVE re-read before the write (never cachedNdefMessage),
  then the guard. New outcome Refused.Occupied. The byte-writing path is untouched:
  encode -> platform round-trip -> writeNdefMessage -> read back -> compare, unchanged.
  FormatException = a foreign card; IOException = Lost, so a card we could not read is never
  assumed blank.
- nfc/WriteTagActivity.kt: THE ROLE NOW GATES THE WRITE. Without an operator session on the
  phone reader mode is never enabled, so the NFC service does not hand this screen a tag at
  all; onTag re-checks behind it. Confirmation box + spent-after-one-write semantics.
- German + English strings for every new state; Written now says what it replaced.

EVIDENCE (executed, not read)
- checks/tag-writer-check.kt 1b runs ELEVEN kinds of card through the real TagWriter against
  fake cards and prints outcome + whether writeNdefMessage appears: blank, our id (same and
  different), legacy host, wrong id confirmed, right id confirmed, foreign URL, Text record,
  unparseable bytes, card lost before the read, 46 bytes.
- core-check 16c runs WriteGuard's own table, asserts the screen's two gates against source,
  and sweeps the eight tap-path files for any mention of the writer/guard/operator session.
- SEEDED RED both ways: deleting the guard call -> 9 FAILs incl. the exact TASK-220 trace;
  deleting the role gate -> 2 FAILs in 16c and nothing anywhere else.
- android/checks/run.sh OK, release-artefact.sh OK (two new simulator needles, red first
  against a stale debug apk).

ARTEFACT: android/dist/nfc-timesheets-0.4.1-6-release.apk, versionCode 6, versionName 0.4.1,
signer CN=NFC TimeSheets OU=HOIV, SHA-256 6c786899199011cd2eb9e600ef02f73dbcdd7aa1f27bb69c78d27aa82c42996c
(same cert as 0.4.0-5, so adb install -r over the field build, no uninstall).

NOT DONE: nothing tested on hardware - no phone, no card here. CORE-FLOW step 1b is the
field check. And on 0.4.1 writing needs POST /operator/enrol, which is still 404 on
production, so this build cannot write a card until the server is deployed.
<!-- SECTION:NOTES:END -->
