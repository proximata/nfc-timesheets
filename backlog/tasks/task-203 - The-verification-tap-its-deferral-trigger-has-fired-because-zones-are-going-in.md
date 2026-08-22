---
id: TASK-203
title: >-
  The verification tap: its deferral trigger has fired, because zones are going
  in
status: In Progress
assignee: []
created_date: '2026-08-19 14:12'
updated_date: '2026-08-22 13:37'
labels:
  - android
  - web
  - zones
  - nfc
  - payroll
dependencies:
  - TASK-198
documentation:
  - backlog/docs/IA-PLAN.md
  - backlog/docs/ZONES-MODEL.md
  - backlog/decisions/decision-43
priority: medium
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IA-PLAN $9.2 deferred this WITH A TRIGGER: 'revisit when tags are deployed in bulk -- more
than one building, or zones going in'. Zones going in IS that trigger. Owner's words at the time:
'this is actually a JTBD that is not designed properly.'

THE PROBLEM, unchanged and now multiplied: a tap is the only way to test a tag; ScanActivity
converges into ACTION_VIEW so a successful diagnostic read CREATES A SHIFT; and there is no
DELETE /admin/shifts/:id anywhere in server/routes/admin.js or web/lib/api.ts. With N zones that
is N undeletable payroll rows per building, every one of which the director must then correct by
hand.

THE THREE OPTIONS, recorded in IA-PLAN so they are not rediscovered:
  (a) live with the junk rows and correct them by hand
  (b) a void-with-reason flag on a shift: admin-only, excluded from payroll AND NAMED there,
      exactly like every other exclusion in this system (decision-10's posture)
  (c) a read-only 'Tag prüfen' mode in the app that reads a tag, names the place it resolves to,
      and does NOT re-enter through ACTION_VIEW
(c) was the standing recommendation: verifying a tag should not be indistinguishable from
starting work.

THIS TASK IS THE DESIGN, NOT THE BUILD. Produce a decision record and, if (b) is chosen, the
migration sketch and the exact payroll wording; if (c), the Android surface and what it must
refuse to do.

UNTIL IT LANDS, the zone drawer (TASK-198) must say in words that the test tap creates a shift
which has to be corrected afterwards. It must not be discovered at the wall.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1..#3 -> D1 (onboard a new client from nothing ★): every new building creates a verification tap, and today it is a real payroll row.
AC#2     -> D7 (month-end payroll ★) and W8: a test flag must be its OWN fact, never a reuse of auto_closed or corrected_at, or a real exclusion becomes indistinguishable from a test.
AC#4     -> D1/D2: until it is decided, the interim copy is what stops the director wondering.
AC#5     -> the deferral is a decision, not an implementation; D6 (correcting the past) is the workaround that stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision record exists, status proposed, choosing (a), (b) or (c) and naming what the other two cost
- [ ] #2 If (b): the flag is a SECOND fact, never a reuse of auto_closed or corrected_at, and the exclusion is NAMED and COUNTED on /payroll/ and /pl/ like decision-10's
- [ ] #3 If (c): the Android surface is specified down to what it must NOT do -- no POST, no ACTION_VIEW re-entry, no client_uuid minted
- [ ] #4 Either way: the interim admin copy in TASK-198 is verified present, in de and en
- [ ] #5 No application code in this task
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DESIGN LANDED as decision-47 + backlog/docs/ZONE-VERIFICATION.md, and option (c) was chosen: a read-only test scan that posts no shift.

THE SERVER HALF IS BUILT, DEPLOYED AND PROVED ON THE LIVE BOX (2026-08-22):
  migration 010    zones.verified_at + verified_by_operator_id, NULLable, NO DEFAULT, zero rows
  the gate         POST /shifts/open -> 422 zone_unverified, no shift row; OPEN only, never CLOSE
  the test scan    GET /operator/zones + POST /operator/zones/:id/verify, auth: operator,
                   resolves through the REAL v.activePlace, requires the card to name the zone,
                   idempotent, and STRUCTURALLY unable to open a shift (no shift route accepts
                   a ts_operator cookie)
  /roster          an unverified zone's ROW is published and its tag_serial is NULLed
  resolve-building DELETED, with every caller

Live proof, against the real HOIV row: ops/prove-zone-verification.sh (the wall card still
answers 201 with an unverified zone under it; the zone's own id 422s with no shift row; the
test scan moves the shift count by 0; a re-scan is idempotent). Its negative case was RUN:
seeding the zone verified at creation turns eleven assertions red.

STILL OPEN, and this task stays In Progress until they land:
  TASK-241  the admin: an unverified zone must be VISIBLY waiting for a test scan
  TASK-242  Android: MODE_VERIFY, err_zone_unverified, and zone_unverified made RETRYABLE

UNTIL TASK-242 ships, do not create a zone at a building where anyone is working: the field
APK renders err_rejected and, worse, treats the refusal as terminal, so an offline tap on a
zone that goes live an hour later is stranded. Production has zero workers today.
<!-- SECTION:NOTES:END -->
