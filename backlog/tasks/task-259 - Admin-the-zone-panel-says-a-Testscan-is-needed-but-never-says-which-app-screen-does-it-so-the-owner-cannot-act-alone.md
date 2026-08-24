---
id: TASK-259
title: >-
  Admin: the zone panel says a Testscan is needed but never says which app
  screen does it, so the owner cannot act alone
status: To Do
assignee: []
created_date: '2026-08-24 19:06'
labels:
  - web
  - zones
  - ux
  - operators
dependencies: []
priority: medium
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND BY: admin-web journey, steps 'As the operator, POST /operator/zones/:id/verify against the new zone' and the preceding zone-creation step. Driven live against a local demo stack with the current web/out build.

WHAT SHIPPED ALREADY (TASK-241, Done — do NOT redo it): a zone with no verified_at reads 'Wartet auf Testscan' with the sentence 'Ein Betreiber muss die Karte vor Ort einmal pruefen. Erst danach kann hier eingestempelt werden.', the building row counts 'N von M Zonen freigeschaltet', and verified rows read 'Freigeschaltet <date> von <operator>'. That is the WHO and the WHY, and it is correct.

THE RESIDUAL GAP, which is what this task is: the panel never says HOW. There is no admin-side equivalent of the verify action by design (decision-47 — the field scan is the whole point, and POST /admin/zones refuses verified_at from the body), so the owner reading only the web panel has no way to learn that the operator needs an enrolment code, opens the app, taps 'Tag pruefen' on the sign-in screen, picks this zone and holds the card to it. The journey confirmed the state transition works end to end — after the verify call the row flipped to '1 von 1 Zone freigeschaltet' — but an owner who does not already know the operator flow is stuck phoning someone.

FIX SHAPE, copy only, no new route and no admin-side verify path: extend zoneWaitingVerificationHint (or add one sentence beside it) to name the concrete steps — issue the operator an enrolment code on /operators/, the operator opens the app and taps 'Tag pruefen' without signing in as a worker, selects this zone, holds the card to the phone. Use the EXACT button wording the phone shows so the owner can read it down the phone to someone standing at a door.

CONSTRAINT: whatever wording is chosen must stay true if TASK-256 renames the iOS button — if the two platforms still disagree on the label at implementation time, name both. There must NEVER be a way to verify a zone from the desk (decision-47).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The unverified-zone row tells the admin which app screen performs the test scan, using the exact button label the phone shows
- [ ] #2 It names the prerequisite — the person doing it needs an operator enrolment code from /operators/ — and links there
- [ ] #3 No admin-side verify control is added anywhere; POST /admin/zones still refuses verified_at from the body (decision-47)
- [ ] #4 The existing TASK-241 copy (Wartet auf Testscan, the N von M count, Freigeschaltet <date> von <operator>) is unchanged
- [ ] #5 de.json and en.json gain the same keys with exact parity, Austrian business German
- [ ] #6 Renders correctly at 390px as well as desktop width
<!-- AC:END -->
