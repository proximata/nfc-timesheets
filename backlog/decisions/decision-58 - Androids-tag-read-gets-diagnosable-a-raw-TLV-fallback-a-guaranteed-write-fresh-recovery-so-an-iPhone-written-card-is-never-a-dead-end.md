---
id: decision-58
title: >-
  Android's tag read gets diagnosable + a raw TLV fallback + a guaranteed
  write-fresh recovery, so an iPhone-written card is never a dead end
date: '2026-08-27 11:03'
status: accepted
---
## Context

An operator scanned a tag written by an iPhone in "Test a tag" on Android and got:
"Card read, but it carries no web address and no known serial number. Technologies:
nfca, mifareultralight, ndef. UID: 04:47:8E..." - a dead end, no recovery action, no
detail on WHY.

Both platforms already write via their OS's own certified high-level NDEF writer
(CoreNFC's `writeNDEF`/`NFCNDEFPayload`, Android's `Ndef.writeNdefMessage`) with matching
TNF=Well-Known + type='U' + the same URI-abbreviation byte - hand-rolling raw low-level
tag formatting on either platform to "standardize the bytes" would mean reimplementing
what each OS vendor already tests against real silicon, which is MORE likely to regress
the two paths that already work (iOS-writes-iOS-reads, Android-writes-Android-reads) than
to fix this. That rewrite is explicitly rejected.

Reading the actual code path (`VerifyZoneActivity.kt`'s `handleRead`/`handleScanFirst`)
found the real, fixable gap: a place id MUST be extracted from the tag LOCALLY, on the
phone, before the server is ever asked anything - `TagLink.locationId()` collapses every
failure mode (malformed URI, wrong scheme, WRONG HOST, wrong path, bad uuid) into the same
null, and if that null happens, decision-55's classifier (`GET /operator/tags/:id`) is
never even called and there is no recovery action offered at all. Given this project's own
recent history (TASK-188: iOS's tagHost was wrong until very recently; decision-53: Android
now accepts EXACTLY ts.tagHost and nothing else, no legacy fallback), the single likeliest
real cause is an iPhone still on a build that wrote the OLD host - which Android is now,
by design, correct to reject outright. But the dead end hides that: today's message cannot
tell "wrong host" from "not our NDEF shape" from "nothing parseable at all".

## Decision

Three additive, Android-only changes. Nothing either platform WRITES changes.

1. **Diagnose, don't collapse.** A new function alongside (not replacing)
   `TagLink.locationId()` returns which of these actually happened: uuid found (unchanged
   path), host mismatch (names the host the tag actually carries), or malformed/absent.
   Used only by the operator scan screens' error copy - every other caller of
   `locationId()` is untouched.

2. **A raw NFC Forum Type 2 Tag fallback reader.** When the platform's own `Ndef`/
   `NdefMessage`/`NdefRecord.toUri()` path produces nothing, fall back to reading the raw
   pages directly (`NfcA`/`MifareUltralight`, starting at page 4), walking the TLV stream
   for the NDEF Message TLV (type 0x03, including the 3-byte extended-length form), and
   feeding the extracted bytes through `NdefTag.uriFrom(ByteArray?)` - the SAME byte-level
   decoder already proven byte-identical against iOS's Swift encoder in an earlier
   cross-language test. This catches any case where Android's convenience API is pickier
   about a technically-valid TLV layout than our own decoder needs to be.

3. **A guaranteed recovery action, not a dead end.** Whichever of the above still fails,
   the Unreadable state on both the worklist-first and scan-first paths
   (`VerifyOutcome.Unreadable`, `ScanStep.Unreadable`) gains a "Write a fresh tag now"
   action, reusing `app.tagWriter` exactly as the existing reassign-building flow already
   does (mint an id, write, report). Whatever is actually on the card, physically in an
   operator's hand, is never a permanent dead end on Android - worst case, it gets
   overwritten with a tag guaranteed to work because it was written and read back by the
   SAME app.

## Consequences

- If the real cause turns out to be a stale iOS build (the likeliest one), item 1 makes
  that immediately visible on the next test scan ("found host X, expected Y") instead of a
  generic error - the actual fix in that case is updating the iPhone, not more Android code.
- Item 3 means an operator can always physically resolve/adopt a card they are holding,
  independent of ever fully diagnosing why the original write didn't round-trip.
- Real-device confirmation is still required - none of this can be proven against a
  simulator, per this project's existing NFC hardware-checklist precedent.
- Android-only; no server or iOS changes. Touches nfc/VerifyZoneActivity.kt,
  core/TagLink.kt, core/NdefTag.kt, a new raw-tag-io file - disjoint from decision-56/57's
  files (ui/TimeSheetApp.kt, ui/Theme.kt), safe to build concurrently with either.

