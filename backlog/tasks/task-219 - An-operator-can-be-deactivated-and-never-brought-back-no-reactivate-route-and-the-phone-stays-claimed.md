---
id: TASK-219
title: >-
  An operator can be deactivated and never brought back: no reactivate route,
  and the phone stays claimed
status: Done
assignee: []
created_date: '2026-08-20 14:01'
updated_date: '2026-08-24 21:55'
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
- [x] #1 an admin can bring a deactivated operator back without touching the database
- [x] #2 the reactivate path never re-points a phone claim: phone_identities is untouched by it
- [x] #3 a phone claimed by a WORKER is still refused, and the refusal is byte-identical to today's (anti-enumeration, decision-45 §7)
- [x] #4 deactivateConfirmBody no longer claims the action is final, in de and en, with exact key parity
- [x] #5 demo/check-operators.mjs covers the round trip and a mutant in demo/operator-mutants.sh shows it RED
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-24 21:55
---
VERIFIED independently at db3833e (not the build agent's claims). Local nfc_demo + node server/server.js on 127.0.0.1:8080. No production touched.

AC1 — way back without touching the DB: created PROBE Verify219 (op id 122) over the wire, DELETE /admin/operators/122 -> {"operator":{"id":122,"active":false}}, POST /admin/operators/122/reactivate -> 200 {"operator":{"id":122,"active":true}}, psql confirms active=true. Unknown id -> 404 {"error":"unknown_operator"} (parity with DELETE's 404). Non-numeric id -> 400 invalid_id. Unauthenticated -> 401 unauthorized (route is auth:"admin").

AC2 — phone_identities untouched (HARD GATE): the handler body is 5 lines and contains ZERO occurrences of phone_identities; the only statement is UPDATE operators SET active = true. Live proof: row_to_json of the operator's phone_identities row before and after the deactivate->reactivate round trip is byte-identical, and the md5 of the WHOLE table is unchanged (52295b06fb345b1b1bf7aef75bbbd978 both sides).

AC3 — worker-held phone still refused, byte-identical (HARD GATE, anti-enumeration, decision-45 §7): (a) source proof — the entire server diff db3833e~1..db3833e is PURELY ADDITIVE (18 added lines, zero removed); createOperator is byte-identical old vs new (sha 886078ac). (b) wire proof — booted the PRE-change admin.js on :8081 alongside the new one on :8080, POSTed the same worker-held +436600000004 to both: bodies cmp byte-identical (hex 7b226572726f72...227d = {"error":"phone_claimed"}), and the response HEADERS diff clean too (409, content-type, content-length: 25, cache-control: no-store). (c) an OPERATOR-held phone (+436600000001) returns the byte-identical refusal, so the 409 still names no role. Nothing written by either refusal.

AC4 — copy no longer claims finality, exact key parity: de 'Sie kann jederzeit wieder aktiviert werden.' / en 'They can be reactivated at any time.'; the old 'nicht rückgängig machen' / 'cannot be undone from this screen' sentences are gone. Parity measured over the WHOLE file, not just this key: 1338 keys in each, zero de-only, zero en-only; 30 ICU-placeholder differences are pre-existing (30 at db3833e~1 too, none in the operators namespace). web/ pnpm check: All checks passed.

AC5 — check + mutants (HARD GATE, run by me, not accepted as a claim): full demo/check-operators.mjs GREEN on the committed tree, twice (before and after the mutant runs): 'all checks green, 1 named gap(s) still open' — the gap is the pre-existing TASK-215 one, untouched. demo/operator-mutants.sh, real output:
  ok reactivate-touches-phone goes RED and NAMES it -> FAIL reactivate: phone_identities is byte-unchanged by the round trip (created_at 23:48:07.825561 -> 23:48:21.51949)
  ok collision-leaks-holder goes RED and NAMES it -> FAIL collision[raw]: byte-identical ... body={"error":"phone_claimed","field":{"taken_by":"operator"}}
  ok reactivate-wrong-handler goes RED and NAMES it (2 assertions: 'row says Aktiv again', 'operators.active flips back to true')
  ok soft-consequence goes RED and NAMES it -> FAIL deactivate: ... no longer claims the action is final
All restored afterwards; git status clean for every touched file; nfc_demo teardown asserts operators 3->3, identities 4->4, codes 0->0.

Also checked, not required: the UI button goes through useTranslations t('activate') with a visually-hidden per-row name, and mirrors deactivate()'s busy guard + error handling.
---
<!-- COMMENTS:END -->
