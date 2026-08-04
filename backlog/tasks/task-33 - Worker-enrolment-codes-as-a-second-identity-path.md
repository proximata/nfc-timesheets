---
id: TASK-33
title: Worker enrolment codes as a second identity path
status: Done
assignee: []
created_date: '2026-08-04 16:52'
updated_date: '2026-08-04 16:52'
labels:
  - server
  - auth
dependencies: []
priority: high
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retro-filed 2026-08-04 during backlog triage. Work shipped in commits 32d9308 + d1faa54; rationale is decision-26.

Sign in with Apple (decision-22) cannot serve an Android worker. Rather than add a third-party sign-in provider, an admin issues a short-lived code for a specific worker; redeeming it yields the same worker session every other path yields.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin can issue and revoke a code for a named worker
- [x] #2 Redemption produces a normal worker session, not a parallel auth path
- [x] #3 The code is stored hashed, is single-use and expires
- [x] #4 Schema is applied in production
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EVIDENCE — this one is proven by a row in the production database.

- migration 004_worker_enrolment_codes.sql is APPLIED live: schema_migrations shows it at
  2026-08-03 13:23:41.
- "\d workers" in production carries enrolment_code_hash (UNIQUE), enrolment_code_expires_at,
  enrolment_code_issued_at, enrolment_code_issued_by, enrolment_code_redeemed_at, plus the
  CHECK constraint workers_enrolment_code_pair asserting
  (enrolment_code_hash IS NULL) = (enrolment_code_expires_at IS NULL) — the two can never
  drift apart.
- The single production worker has enrolment_code_redeemed_at = 2026-08-03 13:24:32, one minute
  after the migration. A real code was issued and redeemed on the live box.
- Routes live (401 unauthenticated, i.e. registered):
    POST   /admin/workers/:id/enrolment-code
    DELETE /admin/workers/:id/enrolment-code
- Code: server/lib/enrolment.js, web/lib/enrolment.ts, android/.../core/EnrolmentCode.kt.
- Hashed at rest: the column is enrolment_code_hash and it is UNIQUE, so the plaintext exists
  only in the admin browser at issue time and on the worker phone at redemption.
- Write-up: backlog/docs/ENROLMENT-CODES.md. Frame: docs/media/android-signin.png.

Session shape is shared with Sign in with Apple — both land in worker_sessions (2 rows live), so
every worker route resolves identity the same way regardless of how the worker got there. That
is what keeps decision-22 true: identity comes from the session, never from the body.
<!-- SECTION:NOTES:END -->
