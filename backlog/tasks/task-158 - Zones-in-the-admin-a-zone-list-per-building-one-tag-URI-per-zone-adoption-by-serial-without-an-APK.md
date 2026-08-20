---
id: TASK-158
title: >-
  Zones in the admin: a zone list per building, one tag URI per zone, adoption
  by serial without an APK
status: Done
assignee: []
created_date: '2026-08-18 03:06'
updated_date: '2026-08-20 04:03'
labels:
  - web
  - ux
  - zones
dependencies:
  - TASK-157
documentation:
  - backlog/docs/ZONES-DESIGN.md
priority: medium
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The director must be able to create a zone and get a working tag onto that wall. Design: backlog/docs/ZONES-DESIGN.md section 6. Reasoning: decision-37 (PROPOSED).

This is the SAME control repeated per zone, not a new pattern. REDESIGN-INVENTORY section 5 calls the building tag-URI block 'the single most load-bearing control on the screen': the URI rendered verbatim in a code-block, one-click copy, the UUID printed underneath, and tagExplainer. A zone gets exactly that, carrying the zone UUID. The slug must never appear in a tag URI (decision-21).

Adoption by serial is the cheap half of D2 and it removes a Play release from the loop: the worker or director opens the app, presses Scan, holds the phone to the foreign tag, reads the UID off the screen and types it into the zone form. That is clunky, and it is one column instead of a release train. ponytail ceiling: an in-app 'adopt this tag' button is the upgrade path.

TWO WARNINGS THE SCREEN MUST CARRY, both from the design doc:
1. a SECOND active zone in a building is unsafe until the zone-aware Android build is on every phone (TASK-159) - before that, an intra-building zone tap is read as a building switch and produces auto_closed=true plus a new shift.
2. the verification tap is an undeletable payroll row (ScanActivity converges into ACTION_VIEW, and there is no DELETE /admin/shifts/:id). With N zones that is N test shifts per building.

Lands on whatever surface owns a building after TASK-155 (the map building panel), and must also be reachable from /locations/.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A building shows its zones as a list, ordered by name, each with its own verbatim tag URI, copy control and UUID; a building with no zones is a normal, un-nagged state
- [ ] #2 Create / rename / deactivate a zone from the building surface; deactivate is soft and the zone's history stays visible
- [ ] #3 A zone can be given an adopted tag serial, and a serial already claimed by another zone is refused with a message naming the conflict
- [ ] #4 Each zone line states whether a tag is physically deployed (tag_deployed_at), whether it is ours or adopted, and when it was last tapped (derived from shifts, not stored)
- [ ] #5 A shift or building tapped at a building-level tag renders a named state - not a blank cell and not an invented zone name
- [ ] #6 The screen states, permanently and in words, that a second zone is unsafe until every phone runs the zone-aware build, and that a verification tap creates a real payroll row
- [ ] #7 de/en key parity exact, German is the real UI language, no hardcoded strings (decision-8/17)
- [ ] #8 Works at 390px (decision-28); the zone list is a list to a screen reader; colour is the second signal and every state is carried by a word
- [ ] #9 pnpm verify green, no new npm dependency
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CLOSED AS A DUPLICATE at 8702615, not as work this run did. TASK-198 carries the same scope, shipped, and is verified in backlog/docs/VERIFY-FINAL.md. Read TASK-198 for the evidence.
This task's body still carried '(PROPOSED - do not build until the owner accepts it)' about decision-37, which is ACCEPTED. Note also that decision-43 SUPERSEDES decision-37 and is still 'proposed' - that contradiction is the owner's to resolve and is not resolved here.
<!-- SECTION:NOTES:END -->
