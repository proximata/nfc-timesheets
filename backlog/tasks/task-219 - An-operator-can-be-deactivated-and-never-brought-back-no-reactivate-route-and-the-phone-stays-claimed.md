---
id: TASK-219
title: >-
  An operator can be deactivated and never brought back: no reactivate route,
  and the phone stays claimed
status: To Do
assignee: []
created_date: '2026-08-20 14:01'
labels:
  - server
  - web
  - operators
dependencies: []
priority: medium
ordinal: 137000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED this session on /operators/ against nfc_demo, and confirmed in the source:

 * DELETE /admin/operators/:id sets active = false and destroys the sessions (server/routes/admin.js deleteOperator). Soft delete, correct.
 * POST /admin/operators is INSERT-ONLY. Its own comment says so: 'a phone that needs to change is a new identity claim, not an edit of an old one'. There is no active: true branch, no upsert, no PATCH.
 * phone_identities keeps the claim. The row survives deactivation by design (the FK is what makes the namespace airtight), so the number cannot be re-registered either.

NET EFFECT, in the director's words: deactivating Karin Bauer removes her from the app AND burns her phone number. Re-creating her with the same number returns 409 phone_claimed forever. Measured: after deactivation, operators.active = false and phone_identities still holds one row for +436649009001.

The screen is HONEST about it today — deactivateConfirmBody says 'Diese Aktion lässt sich auf diesem Bildschirm nicht rückgängig machen', which is why this is a gap and not a lie, and demo/check-operators.mjs asserts that sentence is present. But 'honest about a dead end' is not the same as 'has a way back', and the first time a director deactivates the wrong person there is no self-service repair.

WHAT IT NEEDS. A server change, not a screen change (TASK-214 was web-only and correctly did not invent one):
 (a) POST /admin/operators/:id/reactivate → UPDATE operators SET active = true WHERE id = $1, 404 on unknown, and NOTHING about phone_identities (the claim never left);
 (b) or an upsert branch on POST /admin/operators keyed on the phone already claimed BY AN OPERATOR — riskier, because it has to refuse a phone claimed by a WORKER while accepting one claimed by this very operator;
 (c) the screen then shows 'Wieder aktivieren' on an inactive row, and deactivateConfirmBody stops saying the action is final.

(a) is the ladder answer: one statement, one route entry, symmetric with what /workers/ already does.

NOT DECIDED HERE: whether a reactivated operator should get a fresh enrolment code automatically. Today's issue route refuses inactive operators, so reactivate-then-issue is two clicks, which is fine and is the smaller change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an admin can bring a deactivated operator back without touching the database
- [ ] #2 the reactivate path never re-points a phone claim: phone_identities is untouched by it
- [ ] #3 a phone claimed by a WORKER is still refused, and the refusal is byte-identical to today's (anti-enumeration, decision-45 §7)
- [ ] #4 deactivateConfirmBody no longer claims the action is final, in de and en, with exact key parity
- [ ] #5 demo/check-operators.mjs covers the round trip and a mutant in demo/operator-mutants.sh shows it RED
<!-- AC:END -->
