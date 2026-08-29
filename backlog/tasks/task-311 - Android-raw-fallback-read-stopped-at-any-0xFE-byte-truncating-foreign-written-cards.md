---
id: TASK-311
title: >-
  Android raw fallback read stopped at any 0xFE byte, truncating foreign-written
  cards
status: Done
assignee: []
created_date: '2026-08-29 11:21'
updated_date: '2026-08-29 11:21'
labels:
  - bug
  - android
  - nfc
dependencies: []
ordinal: 229000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DONE IN CODE at commit 79056ba (this is the record the shipping comment in
nfc/RawTagIo.kt and checks/raw-tag-io-check.kt already cites as TASK-311 - the number was
written into source before the task existed, so this record is what makes that reference
resolve).

DEFECT: RawTagIo.collect() ended collection at the first 16-byte chunk containing 0xFE
anywhere in it. 0xFE is a terminator only AT A TLV BOUNDARY; inside another TLV's value it
is ordinary data. A card carrying e.g. a Proprietary TLV with a 0xFE in its value ahead of
the NDEF TLV was cut mid-message, TagTlv correctly refused the truncated buffer, and the
operator was told the card was unreadable - on exactly the foreign-written card the
decision-58 fallback exists to rescue.

FIX: delete the break. Read to MAX_BYTES or the first refusal; TagTlv decides where the data
ends. Cost is 16 page reads instead of 5, on the fallback path only.

WHY NOBODY CAUGHT IT: RawTagIo had never been executed by anything - it imports
android.nfc.tech (no JVM check could load it) and needs a physical Type 2 Tag.

VERIFIED BY THE REVIEW GATE, independently: android/checks/raw-tag-io-check.kt passes, and
red-cased out of tree by restoring the break -> raw-tag-io-check: FAILED, exit 1. So the
check is non-vacuous and the fix is real.

KNOWN CEILING, asserted not fixed (pinned in the check): a NAKing card whose message ends
inside its last straddled 4-page read. Unreachable today - the message is 64 B and
NdefTag.plan refuses any card too small, so every written card has >= 144 B and ends 78 B
clear. Pinned so a future longer URL fails in the check rather than at a door.

STILL NOT PROVEN (needs hardware): that a real NTAG answers readPages the way the stub does,
and that this was the ONLY cause of the operator's report. If the operator still sees an
unreadable card, the next datum needed is the verify_no_uri sentence's tech list plus UID.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 decision-50 frontmatter status matches its body
- [ ] #2 decision-40's proposed/live mismatch is either fixed or explicitly recorded as intentional
<!-- AC:END -->
