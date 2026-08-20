---
id: TASK-197
title: >-
  Three pins with teeth: the unzoned tag resolves, the portal stays minimal, no
  route eats a serial
status: Done
assignee: []
created_date: '2026-08-19 14:00'
updated_date: '2026-08-20 04:02'
labels:
  - server
  - zones
  - security
  - gdpr
  - checks
dependencies:
  - TASK-196
documentation:
  - backlog/decisions/decision-43
  - backlog/decisions/decision-44
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 115000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The guards for decisions 43 and 44. Each one exists because its failure is expensive and
silent. A CHECK WHOSE NEGATIVE CASE CANNOT FAIL IS NOT A CHECK: every one below must be shown
RED first, in the run that lands it.

PIN 1 · AN UNZONED BUILDING'S OWN UUID STILL RESOLVES.
  Seed an ACTIVE building with ZERO active zones (HOIV's exact shape) and tap it.
  GREEN: 201, shift.location_id = that building, start_zone_id NULL.
  RED:   add 'AND EXISTS (SELECT 1 FROM zones z WHERE z.location_id = l.id AND z.active)' to the
         resolver -> 422 unknown_location.
  WHY: 'a building with no zones is inactive' is a PRESENTATION rule. Implemented operationally
  it kills the card on the wall at HOIV on the day 006 lands, and no site visit fixes it.

PIN 2 · NO ZONE AND NO AREA REACHES THE CLIENT PORTAL.
  Seed a building with two named zones, an area, and a portal grant. Fetch GET /portal/:token.
  GREEN: the body contains neither zone name, no 'zone' key, no 'area' key, no m2 figure; the
         payload is still {building:{name}, cleanings:[{date, first_name, minutes}]}.
  RED:   add z.name to the portal select list -> the assertion fires.
  ALSO assert that portal_grants has no zone-scoped column and that no route mints a grant
  against a zone id. A zone name is internal building structure; area + contract value is our
  price per square metre in the hands of the party negotiating it. The payload's minimality IS
  the lawful-basis argument written at the top of routes/portal.js.

PIN 3 · NO ROUTE ACCEPTS A TAG SERIAL AS INPUT.
  GREEN: no request body, query parameter or path segment anywhere in server/routes/ is parsed
         as a serial. The serial travels server -> phone only, inside /roster.
  RED:   add a serial-accepting branch to any route -> the assertion fires.
  WHY: a serial is broadcast in the clear and is clonable. Under this design it never reaches
  the server at all -- the phone matches it locally and sends the resolved place UUID, which the
  server resolves itself, with the worker taken from session.workerId (decision-22). That is a
  stronger statement than any rate limit, and it is worth keeping true by machine.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#5,#6 -> §6 „four facts that live only in a human's memory": a pin is how the fact stops being memory.
AC#2       -> W3 (clock in ★): the unzoned building tap. Failure = the card on the wall dies on migration day.
AC#3       -> C2 (client checks a building) and D10 (give a contact a link, take it away): the portal's minimality is the lawful-basis argument.
AC#4       -> D2 (get a working tag onto a wall) and W10: a serial must never become an accepted identifier on a public route.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All three pins live in server/check-api.js beside the existing redaction assertions
- [ ] #2 Pin 1 demonstrated RED by the stated resolver mutation, then green
- [ ] #3 Pin 2 demonstrated RED by adding a zone name to the portal select list, then green
- [ ] #4 Pin 3 demonstrated RED by adding a serial-accepting branch, then green
- [ ] #5 The mutations are reverted; the working tree is clean afterwards
- [ ] #6 Each pin's comment names the decision and the cost of its failure, not just the assertion
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 (backlog/docs/VERIFY-FINAL.md).
node server/check-api.js -> PASS, including by name 'no route anywhere accepts a tag serial as INPUT' and 'no zone name and no area ever reaches the client portal'.
Pin 1's mutation is now permanent tooling rather than a one-off: server/db/check-field-wire-mutants.sh, 8 mutants, all RED, git diff --quiet after.
Raw serial posted as a place -> 400 (PROBE-DATA §4): a serial is not a credential (decision-44 §3).
<!-- SECTION:NOTES:END -->
