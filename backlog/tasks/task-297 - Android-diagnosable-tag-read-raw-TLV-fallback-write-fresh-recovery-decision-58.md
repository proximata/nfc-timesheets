---
id: TASK-297
title: >-
  Android: diagnosable tag read + raw TLV fallback + write-fresh recovery
  (decision-58)
status: In Progress
assignee: []
created_date: '2026-08-27 11:04'
updated_date: '2026-08-27 11:29'
labels:
  - android
  - decision-58
  - nfc
dependencies: []
priority: high
ordinal: 215000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TagLink.kt gains a new diagnostic function alongside locationId() (unchanged) that distinguishes uuid-found / host-mismatch (names the found host) / malformed-or-absent; core-check.kt covers all three cases with fixed byte inputs
- [x] #2 a new raw Type-2-Tag TLV reader (NfcA/MifareUltralight page read from page 4, walks Lock/Memory Control TLVs, finds the NDEF Message TLV incl. 3-byte extended length) feeds extracted bytes through the EXISTING NdefTag.uriFrom(ByteArray?); used as a fallback in VerifyZoneActivity's read path whenever the stock Ndef/NdefMessage/toUri() route returns nothing
- [x] #3 VerifyZoneActivity's Unreadable outcome (both ScanStep.Unreadable and VerifyOutcome.Unreadable) shows the new specific diagnosis (host mismatch names the host found; otherwise generic unreadable) instead of one generic message
- [x] #4 Unreadable state (both worklist-first and scan-first) gains a 'Write a fresh tag now' recovery action reusing app.tagWriter exactly as the existing reassign-building flow does (mint id, write, report via the existing operator/tags route); success navigates into the new zone same as any other fresh write
- [x] #5 the existing debug simulation mechanism covers: host-mismatch diagnosis, raw-fallback success where stock API fails, and the write-fresh recovery action, with zero simulation code reachable in a release build
- [x] #6 android/checks/run.sh passes clean; DE/EN strings.xml parity holds for any new copy
- [x] #7 confirm via git diff --stat that only android/ files changed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in d27e740 (android/ only, 10 files). REVIEW GATE re-verified independently 2026-08-27 (read the diff, ran the checks, mutation-tested the new fixtures). Stays In Progress.

VERIFIED BY THE REVIEWER, not taken from the implementer's report:
- AC1 locationId() is byte-identical: git diff on TagLink.kt is +34/-0, one hunk, opening after locationId()'s closing brace. diagnose() returns HostMismatch(found) carrying the host string; core-check asserts found=='timesheets-old.example.org'. MUTATION TEST: replacing URI.getHost() with a string-prefix parse makes core-check print 'FAIL: userinfo does not make it our host, in the diagnosis either: HostMismatch(found=timesheets.exe.xyz@evil.example.com)' -> the assertion bites.
- AC2 the TLV fixtures are real hand-built byte arrays, not a mock. MUTATION TEST: making the walker return the first TLV regardless of type prints 'FAIL: NULL, Lock Control, Memory Control and Proprietary TLVs are stepped over, not parsed' + 'FAIL: raw pages -> TagTlv -> NdefTag.uriFrom -> TagLink resolves to the same id'. Fallback wired at VerifyZoneActivity.kt:1499 as 'readUri(tag)?.toString() ?: RawTagIo.uri(tag)' and NOWHERE ELSE: grep shows RawTagIo has exactly one call site, and ScanActivity (the worker clock-in path) is untouched.
- AC4 FreshCardSection() is called twice: line 404 under 'if (scanStep is ScanStep.Unreadable)' (scan-first) and line 490 under 'if (outcome is VerifyOutcome.Unreadable)' (worklist-first). Both confirmed by reading the composable. Write uses confirmedOverwriteOf = null (no overwrite override).
- AC5 source-set split confirmed: no simulation symbol is DEFINED under app/src/main (grep); isSimulatedTag() is a constant false in src/release. gradlew compileDebugKotlin compileReleaseKotlin both exit 0 (reviewer-run), which is what proves each variant sees exactly one definition.
- AC6 android/checks/run.sh reviewer-run, exit 0: core-check: OK / known-tags-check: OK / tag-writer-check: OK / manifest-check: OK / verify-no-shift-check: OK. node ops/check-branding.mjs also exit 0 with zero TODO/WARN lines.
- AC7 git show --name-status d27e740: 10 paths, all under android/. Nothing else in the commit.

CORRECTIONS TO THE IMPLEMENTER'S REPORT:
- 11 new string keys, not 13 (11 added to values/ and 11 to values-en/, all 11 referenced from Kotlin; verified by grep).
- src/release runFreshZoneSimulation() is NOT a no-op — it fabricates a WireOperatorZone. It is unreachable (isSimulatedTag() is constantly false) and matches the existing runReassignSimulation precedent, so this is a wording correction, not a defect.

REMAINING (why this is not Done):
1. STRAY-TAP HOLE in the new recovery flow, found by review, not yet fixed. readerWanted() gains only 'freshStep is AwaitingCard || WriteRefused -> true' and has NO clause suppressing the reader for the OTHER fresh states, whereas the reassign flow it copies does exactly that ('reassignStep !is Idle && !is Done -> false'). So during Reporting / Naming / Submitting / Failed the reader is still armed (scan-first: 'selectedZone == null -> true'; worklist-first: 'selectedZone?.isBound == true'), onTag falls past the fresh branch into handleScanFirst/handleRead, scanStep/outcome stop being Unreadable, FreshCardSection stops being drawn — and the card is by then WRITTEN and REPORTED with no zone created, on a screen that no longer offers the recovery. The operator is at a door with the card in the other hand, so a second tap while typing the zone name is a realistic input, not a theoretical one. Fix is one clause next to the existing one: 'freshStep !is FreshStep.Idle -> false' after the AwaitingCard/WriteRefused arm.
2. TWO TLV ASSERTIONS ARE EQUIVALENT-MUTANT-PASSING, i.e. weaker than their comments claim. Deleting the 'if (length < LONG_FORM) return null' guard does NOT fail core-check (its fixture 03 FF 00 10 01 is also caught by the runs-past-the-end rule), and reading the 3-byte length as 8 bits (ignoring the high byte) does NOT fail it either (the long fixture's high byte is 0x00). A fixture with a length above 255 (e.g. 0x01 0x00 = 256) would pin both. Our own messages are ~64 bytes so the long form only ever appears on a foreign card — low severity, real gap.
3. checks/release-artefact.sh NOT run: needs signed release + debug APKs, which neither the implementation run nor this review built. AC5 rests on the source-set split and on both variants compiling, not yet on the dex. Note the existing NEEDLES list would still catch the new fixtures if they shipped, because every new label starts with 'SIMULATED' and that is already needle #1 — but no needle was added for the decision-58 scenarios specifically.
4. NO REAL-DEVICE CONFIRMATION of the raw TLV page reads (RawTagIo, which is the half android/checks structurally cannot cover) or of the write-fresh recovery. decision-58 requires it; NFC does not exist on an emulator.
5. Android has NO placeholder-parity gate (core-check checks key SETS only, unlike web/scripts/check.mjs). The 3-arg verify_no_uri_host and the 1-arg verify_fresh_* strings were checked by hand, DE and EN agree.
<!-- SECTION:NOTES:END -->
