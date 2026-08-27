---
id: TASK-297
title: >-
  Android: diagnosable tag read + raw TLV fallback + write-fresh recovery
  (decision-58)
status: In Progress
assignee: []
created_date: '2026-08-27 11:04'
updated_date: '2026-08-27 11:14'
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
