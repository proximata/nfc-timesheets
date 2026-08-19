---
id: TASK-202
title: >-
  Put the zone-aware APK on the field phone, then and only then a second tag on
  a wall
status: To Do
assignee: []
created_date: '2026-08-19 14:12'
labels:
  - android
  - ops
  - zones
  - nfc
  - evidence
dependencies:
  - TASK-201
documentation:
  - backlog/decisions/decision-43
  - backlog/decisions/decision-40
priority: high
ordinal: 120000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-43, the deployment gate. ZONES-MODEL.md $3.3.

THE FAILURE THIS PREVENTS: the shipped build compares raw tag ids, so an intra-building zone tap
reads as a BUILDING SWITCH -- auto_closed = true, a new shift, and the old one unpayable until a
human resolves it. A five-zone building generates a flood of unresolved, unpaid work.

decision-37 called this landmine #1 because Play's internal track offered no way to force an
update. That is no longer the situation: ONE phone, a sideloaded APK, adb install -r.

  adb install -r   NEVER uninstall first. Same key + same applicationId + higher versionCode
                   installs OVER and keeps SharedPreferences, so the worker stays signed in.
                   Uninstalling wipes the session and costs a new enrolment code.

STEPS, in order, none skippable:
  1  adb install -r the versionCode 4 APK
  2  adb shell pm get-app-links io.github.qwadratic.NFCTimeSheets
     -> timesheets.exe.xyz: verified          (only provable on the device)
  3  tap the MOUNTED EV1 (04:A1:A8:52:AE:5C:80) once -> a shift opens at HOIV via the ROSTER,
     with KnownTags gone. This is the proof that TASK-201 step 3 did not strand the tag.
  4  tap it again -> the shift CLOSES, auto_closed false
  5  confirm the worker did NOT have to re-enrol
  ONLY AFTER 1-5: a second physical tag may go on any wall.

Until step 5 is recorded here, the admin surface keeps its second-zone warning (TASK-198).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 adb install -r completed; the worker session survived and no enrolment code was issued
- [ ] #2 pm get-app-links reports timesheets.exe.xyz verified, pasted into the notes
- [ ] #3 The mounted EV1 tag opens AND closes a shift at HOIV with KnownTags deleted -- resolved through the roster
- [ ] #4 A zone tag and the building tag in the same building both close the same shift; no auto_closed shift is produced
- [ ] #5 Evidence recorded: versionCode, signing fingerprint, adb output, and the shift ids created and closed
- [ ] #6 Only after all of the above: the second-zone warning is removed from the admin surface
<!-- AC:END -->
