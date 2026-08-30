---
id: TASK-324
title: >-
  decision-62: iOS drops the roster on update, Android deliberately does not -
  pick one behaviour
status: To Do
assignee: []
created_date: '2026-08-29 23:04'
labels:
  - ios
  - android
dependencies: []
priority: medium
ordinal: 242000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both platforms implement decision-62 correctly on the load-bearing half (verified by reading the
source: iOS invalidateCachesIfUpdated deletes only Site rows + OperatorZoneCache; Android
onCreate calls operatorZones.clear() only; neither touches cookies, the shift write queue,
materials, pendingTagReport or the schema; the SwiftData models carry NO @Relationship at all, so
deleting Site cannot cascade into Shift).

They disagree on the ROSTER, and the disagreement is unflagged:

  Android TimeSheetsApplication.kt argues explicitly for KEEPING it - restoreSession -> refresh()
  refetches every launch and 'the refetch swallows network failure by design', so a phone that
  updates and is then opened in a basement would lose the building names for nothing.

  iOS deletes it (NFCTimeSheetsApp.swift:201) and refreshRoster is 'guard let ... try? ... else
  return' - the same swallow. Observed: after a bump with no server reachable, sites goes 8 -> 0
  and never refills.

CONSEQUENCE, bounded but real: on the ONE launch after an update, offline, iOS's 'Start without a
tag' picker is empty ('No buildings on this phone yet'). Tap clock-in is unaffected (the roster
guard was deliberately deleted, the server is authoritative, decision-19).

Not a decision-62 violation - Site IS a cached read. It is a platform inconsistency neither lane
named, on the platform that deletes more. Owner picks: either iOS stops deleting Site (matching
Android's argument, which is the stronger one) or Android starts, and the reason is written down.

SECOND, SMALLER GAP: Android core-check §19 asserts onCreate never contains store/cookies/
materials/pendingTagReport .clear(). iOS's checks/app-update-check.swift tests only the arithmetic,
so nothing on iOS would stop a future edit adding a Shift delete to invalidateCachesIfUpdated.
Same asymmetry as TASK-323, on the higher-risk platform.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 one documented behaviour for the roster on update, same on both platforms
- [ ] #2 iOS gains a blast-radius assertion equivalent to Android core-check section 19
- [ ] #3 verified offline: after a version bump with no server, the Start-without-a-tag picker behaves as the chosen decision says
<!-- AC:END -->
