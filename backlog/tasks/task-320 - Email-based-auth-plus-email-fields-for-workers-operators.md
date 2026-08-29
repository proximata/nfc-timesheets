---
id: TASK-320
title: Email-based auth plus email fields for workers/operators
status: To Do
assignee: []
created_date: '2026-08-29 19:55'
labels:
  - 'for agent: clarify with operator'
dependencies: []
priority: medium
ordinal: 238000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Confirmed current state: workers.email already exists (migration 002, UNIQUE, lowercase-checked) but it was added for Sign in with Apple eligibility, and Apple Sign-In was formally retired from the worker app by decision-50 (accepted) - so today workers.email is a vestigial column no live login path reads. Operators have NO email column at all (migration 007). decision-50 already names the two sanctioned worker/operator login doors as SMS OTP and enrolment code; adding email auth would be a THIRD door and needs its own decision the same shape as decision-50, not a silent addition.

Open questions for the operator before this is designed: is this for worker login, operator login, or both; email OTP (a code sent by email, mirroring the existing SMS OTP shape) or a magic link (different UX/security shape, needs its own token/expiry design); who supplies the email - self-entered by the worker/operator, or admin-provisioned up front the same way phone numbers are today (decision-45/48); does this REPLACE any existing door or sit alongside SMS+enrolment-code as a third option; if alongside, does the sms_login-style feature flag pattern (decision-57/59) apply here too so it can be toggled off cleanly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator has confirmed: OTP vs magic link, and whether this is worker, operator, or both
- [ ] #2 Confirmed this replaces vs sits alongside the existing SMS/enrolment-code doors, with a decision record drafted either way
<!-- AC:END -->
