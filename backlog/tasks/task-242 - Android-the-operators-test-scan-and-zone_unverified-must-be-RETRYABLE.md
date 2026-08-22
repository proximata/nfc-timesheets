---
id: TASK-242
title: 'Android: the operator''s test scan, and zone_unverified must be RETRYABLE'
status: Done
assignee: []
created_date: '2026-08-22 13:37'
updated_date: '2026-08-22 20:48'
labels:
  - android
  - zones
  - nfc
  - payroll
dependencies: []
priority: high
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-47 §5-§7 and backlog/docs/ZONE-VERIFICATION.md §6.4, §7.1. THE SERVER IS DEPLOYED AND LIVE: POST /shifts/open answers 422 zone_unverified for a zone no operator has test-scanned, and GET /operator/zones + POST /operator/zones/:id/verify are the only way through it.

THE MOST DANGEROUS LINE FIRST — zone_unverified MUST BE RETRYABLE in ApiFailure.isRetryable. SyncPlan.blocksRow = !isRetryable, ShiftSync then calls store.markFailed(blocked = true), and NOTHING clears sync_blocked except markOpenSynced/markCloseSynced, which are unreachable for a row that is never planned again. ShiftStore.startShift writes the local row BEFORE the sync attempt, so the hours exist on the phone and would simply never be sent: a tap taken offline in a stairwell and pushed after the operator verified the zone is HOURS A CLEANER WORKED THAT THE PHONE NEVER SENDS. It is a temporary state of the SERVER's configuration, not a defect in the payload — the identical bytes succeed the moment the zone goes live. It cannot spin: the queue drains only on tap, on pull-to-refresh, and when the log screen appears. (Same class as TASK-240's tag_unbound, filed separately.)

STRINGS: err_zone_unverified, de/en exact key parity. de: 'Dieser Tag ist noch nicht freigeschaltet. Es wurde keine Schicht gestartet. Bitte bei der Verwaltung melden.' android/checks/core-check.kt already asserts every key ApiFailure.messageKey can return exists in strings.xml, so a missing string cannot ship as a blank line. The APK CURRENTLY IN THE FIELD falls through to err_rejected — a sentence, not a crash, and still no shift row — but treats it as TERMINAL, which is the defect above.

MODE_VERIFY on ScanActivity (which already runs reader mode and already resolves a card three ways): started ONLY from the operator's 'Tag prüfen' entry, gated on the stored ts_operator cookie FROM DISK exactly as WriteTagActivity gates the write (the operator is in a stairwell). It NEVER starts an ACTION_VIEW intent and never reaches TapInbox. It fetches GET /operator/zones (cached — the stairwell has no signal), the operator PICKS the zone first (that pre-selection IS the check that catches a card mounted at the wrong door, and a URL-less adopted card cannot be resolved without the list), then holds the card: a URL is parsed by TagLink; a bare UID is matched CLIENT-SIDE against tag_serial in that list. It POSTs the resolved zone uuid through operatorApi. NO SERIAL EVER TRAVELS TO THE SERVER (decision-44's pin).

ACCEPTANCE EVIDENCE: NFC never works on an emulator, so any proof goes through the existing DEBUG-only mock hook AND android/checks/release-artefact.sh must show that hook absent FROM THE RELEASE DEX, not from a reading of the Kotlin. Plus a JVM check that ApiFailure('zone_unverified').isRetryable is true and SyncPlan.blocksRow is false, with its RED case being flipping it.

SEQUENCING, from ZONE-VERIFICATION.md §9: until this ships, DO NOT create a zone at a building where anyone is working. Production has zero workers today, so nothing is at risk yet.

MUST NOT REGRESS: KnownTags.kt stays (decision-44 step 5 now reads: delete it only after a zone carries the HOIV serial AND that zone is VERIFIED). /roster already NULLs an unverified zone's tag_serial so the compiled fallback keeps winning.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped across App-phase commits 31e42cf/299483a/a52b7e5/19681ff/f7e5c92, which landed before the phase died. Verified by reading source, not by trusting the report: ApiFailure.isRetryable=true for zone_unverified with a core-check assertion pinning it (android/checks/core-check.kt:259-260), VerifyZoneActivity wired into TimeSheetApp.kt's real onClick and AndroidManifest.xml, gated on the operator cookie. Not verified on hardware - no card, no device; that stays the owner's.
<!-- SECTION:NOTES:END -->
