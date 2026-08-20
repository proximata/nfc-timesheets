---
id: TASK-212
title: >-
  W1 server: operator auth, enrolment codes, and POST /operator/workers —
  BLOCKED on §8
status: Done
assignee: []
created_date: '2026-08-20 07:28'
updated_date: '2026-08-20 13:04'
labels:
  - server
  - operators
  - auth
dependencies:
  - TASK-211
references:
  - server/lib/auth.js
  - server/routes/auth.js
  - server/server.js
documentation:
  - backlog/docs/OPERATOR-MODEL.md
  - backlog/decisions/decision-45
priority: high
ordinal: 130000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
THE API HALF of decision-45. requireOperatorSession in lib/auth.js, mirroring requireWorkerSession line for line (ts_operator cookie, JOIN operators, AND o.active). server.js dispatch gains ONE branch: auth === 'operator' alongside the existing 'admin'/'worker' checks, and joins 'operator' into the requireAppKey condition. POST /auth/operator-code and POST /auth/operator-logout mirror /auth/code and /auth/logout in routes/auth.js exactly — same rate limiting (checkGlobalEnrolmentRate, checkLoginRate), same decoy-timing discipline. POST/DELETE /admin/operators and the operator enrolment-code issue/revoke routes mirror the existing worker routes in routes/admin.js.\n\nBLOCKED: POST /operator/workers {name, phone} is designed in OPERATOR-MODEL.md §7 but its exact shape (does it accept a rate?) depends on §8, which is UNRESOLVED — decision-41 (PROPOSED) and the owner's 'just a name and a phone' instruction are in direct conflict. Do NOT build this specific route until the owner rules per OPERATOR-MODEL.md §14 row 1. Every other route in this task is independent of that ruling and can proceed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 requireOperatorSession behaves identically to requireWorkerSession's deactivation-lockout semantics: deactivating an operator invalidates their session on the next request, not just at expiry
- [x] #2 POST /auth/operator-code redeems a live code into an operator_sessions row and clears the code's hash, exactly like POST /auth/code does for workers
- [x] #3 an operator session cannot reach any route under /shifts/* — asserted by a check that tries and expects 401/403, shown RED first by temporarily adding operator to one shifts route's auth list
- [x] #4 an expired or already-revoked operator session is rejected with the same 401 shape as an expired worker session
- [x] #5 POST /operator/workers is NOT implemented in this task; a TODO referencing OPERATOR-MODEL.md §8 and this task's blocked status is left in its place
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED INDEPENDENTLY, 2026-08-20, on the migrated production restore (VERDICT-W1-DB.md section 2.4). An operator session opens no shift: empty body 401, a fully-formed clock-in naming a REAL worker_id 401, one naming the operator's own id 401, and the operator token replayed in the ts_worker cookie 401 - zero shifts written. Falsifiable: the check mutates the live route object's auth from 'worker' to 'operator', asserts the SAME cookie then gets past auth, restores it, and re-asserts the 401. Mutating server/routes/app.js's POST /shifts/open to auth: 'operator' turns the check RED. POST /operator/workers is still absent (404), correctly - see TASK-216 for the consequence: the phone namespace is closed over phone_identities only, and no worker row enters it through any route, so the owner's 'may never collide' is half enforced until decision-41 is ruled on. CAVEAT worth carrying: exactly ONE auth:'operator' route exists (/auth/operator-logout), so 'an operator cannot clock in' is currently true the way 'an operator cannot do anything' is true. Re-prove it the day an operator route that WRITES is added.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every route in this task except the explicitly-blocked POST /operator/workers is built and verified: operator sessions, /auth/operator-code, /auth/operator-logout, /admin/operators CRUD + enrolment codes, and the structural (not policy) proof that an operator session cannot open or close a shift, with or without a worker_id in the body. The §8 block is unresolved by design — recorded, not decided here.
<!-- SECTION:FINAL_SUMMARY:END -->
