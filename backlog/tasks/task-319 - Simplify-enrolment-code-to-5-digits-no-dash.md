---
id: TASK-319
title: 'Simplify enrolment code to 5 digits, no dash'
status: To Do
assignee: []
created_date: '2026-08-29 19:55'
labels:
  - 'for agent: clarify with operator'
dependencies: []
priority: medium
ordinal: 237000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Confirmed current shape via server/lib/enrolment.js: the enrolment code (worker AND operator, same code, verbatim shared shape per migration 007s own comment) is 8 characters of Crockford base32 (digits plus most letters, excluding lookalikes), shown to the admin hyphenated as XXXX-XXXX. That is a ~40-bit secret, and enrolment.js says so explicitly in its own comment: a CSPRNG bearer secret behind short expiry, single use, and rate limiting - not a password. OTP (the SMS one-time code, separate mechanism) is already 6 digits with no dash, so this request is specifically about the enrolment code, not OTP.

Dropping to 5 digits (10^5 = ~100,000 possibilities, versus todays ~1.1 trillion) is a real security posture change, not a cosmetic one - codes are checked against all live codes system-wide (not scoped to one worker), so brute-forcing 100,000 values is a meaningfully easier target unless the existing TTL/single-use/rate-limit trio is tightened to compensate.

Open questions for the operator before this is designed: does "5 digits" mean pure numeric 0-9 (dropping letters entirely, unlike todays mixed alphanumeric), confirm; does this apply to worker codes, operator codes, or both (they currently share one implementation); is the operator explicitly accepting the entropy tradeoff, or does the rate-limit/TTL need tightening first to compensate for the much smaller keyspace; should the hyphenated display format go away too even if the digit count stayed at 8 (title asks for no dash specifically).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Operator has explicitly accepted the entropy tradeoff (100k possibilities vs current 1.1 trillion), or specified compensating rate-limit/TTL changes
- [ ] #2 Confirmed scope: worker codes, operator codes, or both
<!-- AC:END -->
