---
id: TASK-220
title: Tag beschreiben silently overwrites a live mounted card
status: To Do
assignee: []
created_date: '2026-08-20 19:53'
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
- [ ] #1 A card already carrying a DIFFERENT known location id is refused with no write in the observed call log
- [ ] #2 Re-presenting a card holding the SAME offered id still writes (failed-verify retry survives)
- [ ] #3 Blank and foreign-content cards behave exactly as today
<!-- AC:END -->
