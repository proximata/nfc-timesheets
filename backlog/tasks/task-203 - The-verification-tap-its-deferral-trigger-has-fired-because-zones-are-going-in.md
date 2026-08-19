---
id: TASK-203
title: >-
  The verification tap: its deferral trigger has fired, because zones are going
  in
status: To Do
assignee: []
created_date: '2026-08-19 14:12'
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
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision record exists, status proposed, choosing (a), (b) or (c) and naming what the other two cost
- [ ] #2 If (b): the flag is a SECOND fact, never a reuse of auto_closed or corrected_at, and the exclusion is NAMED and COUNTED on /payroll/ and /pl/ like decision-10's
- [ ] #3 If (c): the Android surface is specified down to what it must NOT do -- no POST, no ACTION_VIEW re-entry, no client_uuid minted
- [ ] #4 Either way: the interim admin copy in TASK-198 is verified present, in de and en
- [ ] #5 No application code in this task
<!-- AC:END -->
