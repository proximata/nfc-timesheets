---
id: TASK-201
title: >-
  Android: any zone of the same building closes the shift, and KnownTags is
  deleted
status: In Progress
assignee: []
created_date: '2026-08-19 14:09'
updated_date: '2026-08-20 04:03'
labels:
  - android
  - zones
  - nfc
dependencies:
  - TASK-196
  - TASK-198
documentation:
  - backlog/decisions/decision-43
  - backlog/decisions/decision-44
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 119000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decisions 43 and 44, the client half. ZONES-MODEL.md $3.3, $4.4.

*** DO NOT START STEP 3 BELOW UNTIL A ZONE ROW CARRIES THE HOIV SERIAL AND /roster PROVES IT ***
Deleting KnownTags.kt while no zone carries 04:A1:A8:52:AE:5C:80 STRANDS the mounted tag: the
only working tap at the only live building stops working, and no site visit fixes it -- only a
new APK or a database row does.

1 · THE SWITCH RULE. TimeSheetViewModel currently compares raw tag ids
    (running.locationId == locationId). It becomes:
        buildingOf(tappedPlaceId) == running.locationId  -> CLOSE
    where buildingOf() reads the CACHED roster (zone -> location_id), because a stairwell has no
    signal and A CACHE MISS MAY NEVER BLOCK A CLOCK-IN. On a miss, treat the tapped id as its own
    building -- today's behaviour -- rather than refusing.
    Rule, in full: no open shift -> open; ANY ZONE OF THE SAME BUILDING -> close, auto_closed
    false; a different building -> close with auto_closed true and open the new one (decision-10,
    unchanged).

2 · THE RUNNING SCREEN STATES IT IN WORDS:
    'Der nächste Tag-Kontakt in diesem Objekt – egal welcher – beendet die Schicht.'
    de/en key parity. It also names the zone when there is one.

3 · SERIALS FROM THE ROSTER, AND KnownTags DELETED.
    Api.kt parses the new zones array; ShiftStore persists it beside locations (SQLite, so it
    survives a cold launch offline). ScanActivity:147 resolves the serial from that cache.
    DELETE: nfc/KnownTags.kt, checks/known-tags-check.kt, and its block in checks/run.sh.
    An unknown serial shows 'Unbekannter Tag' + the serial in copyable form and posts NOTHING --
    the same terminal state KnownTags.locationIdFor returning null reaches today.

4 · CLOSE THE RESIDUAL HOLE, and it belongs in this task. ShiftSync swallows a roster fetch
    failure silently, so a fresh install whose FIRST roster fetch failed would have an empty zone
    cache and no compiled fallback. Fetch the roster as part of enrolment redemption and retry on
    every foreground, so 'signed in but has never seen a roster' is not a reachable resting state.

5 · POST /shifts/close gains the optional location_uuid (the place tapped) so end_zone_id lands.

BUILD: JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home,
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools, keystore password in psst tag android.
versionCode 4. The SAME upload key as versionCode 3, or the field phone's install-over --and the
worker session in SharedPreferences -- is lost.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1     -> D2 (get a working tag onto a wall): the GATE. The mounted EV1 must already be in /roster before KnownTags is deleted, or the only live tap dies.
AC#2     -> W5 (clock out ★ top-ranked) and W6 (two buildings, one shift): the second tap in the same building must CLOSE, not switch.
AC#3     -> W3 (clock in ★) and W10 (a tap that did nothing): a cold cache must still open a shift.
AC#4     -> W4 (working): the running screen says in words what the next tap will do.
AC#5,#6  -> W10 + §6 („which buildings have a tag, and is it ours"): an unknown serial is copyable, and posts nothing.
AC#7,#8  -> P1 (Play/APK): same key, versionCode 4, and installation is TASK-202's evidence, not this one's.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GATE, checked first and recorded in the notes: GET /roster returns 04:A1:A8:52:AE:5C:80 mapped to a zone of HOIV. If it does not, this task stops here
- [ ] #2 RED, seeded (JVM check): two zones of one building -> the second tap CLOSES. Revert to raw-id comparison -> a building switch is produced and the check goes red
- [ ] #3 RED, seeded: an empty roster cache + a zone tag -> the tap still OPENS a shift rather than being refused. Add a cache-required guard -> red
- [ ] #4 The running screen carries the next-tap sentence in de and en, with exact key parity
- [ ] #5 KnownTags.kt, checks/known-tags-check.kt and its run.sh block are gone; android/checks passes without them
- [ ] #6 An unknown serial renders 'Unbekannter Tag' with the serial copyable and posts nothing
- [ ] #7 APK builds signed with the same key as versionCode 3; versionCode 4; manifest still autoVerifies ONLY the permanent tag host
- [ ] #8 NOT installed on the field phone in this task -- that is TASK-202
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIAL at 8702615 (backlog/docs/VERIFY-FINAL.md). RECON N1 said 'Android beyond the Host phase: NOT STARTED'. That is STALE - eight commits landed after it was written: 20a5d6e e950f7f 66d1445 ad2cd35 e2feae2 c0cac05 4ea9187 7d4d2fc 71df8b3.
DONE and verified off-device:
  AC#2/#3 cd android && ./checks/run.sh -> core-check: OK (311 assertions), known-tags-check: OK (27). By name: 'two zones of the SAME building compare equal once resolved (the fix TimeSheetViewModel.sameBuilding relies on)', 'zones of DIFFERENT buildings still compare unequal', 'a missing "zones" key degrades to an empty list, never a throw'.
  AC#7 android/app/build/outputs/apk/release/app-release.apk - aapt2: versionCode 4, versionName 0.3.0, package io.github.qwadratic.NFCTimeSheets. apksigner: CN=NFC TimeSheets, OU=HOIV, SHA-256 6c78...996c = the single fingerprint in ops/branding.json. Every android:host under the autoVerify filter is timesheets.exe.xyz - the PERMANENT tag host, four times, and the renameable API host appears only as a dex string (decision-40).
NOT DONE:
  AC#5 KnownTags.kt, checks/known-tags-check.kt and its run.sh block are STILL PRESENT - correctly. decision-44 deletes them only after a zone carries the serial, and no zone exists in production because 006 is not applied. The gate has not fired.
  AC#1 the GATE itself is unrun: production's GET /roster cannot return 04:A1:A8:52:AE:5C:80 mapped to a zone until 006 is applied there.
  AC#6 'Unbekannter Tag' with a copyable serial: not measured on any device.
NOT INSTALLED on the field phone - that is TASK-202, and it is the highest-cost open item on this board.
<!-- SECTION:NOTES:END -->
