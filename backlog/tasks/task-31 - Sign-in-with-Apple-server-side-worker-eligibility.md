---
id: TASK-31
title: Sign in with Apple + server-side worker eligibility
status: Done
assignee: []
created_date: '2026-07-28 17:48'
updated_date: '2026-08-04 16:51'
labels: []
dependencies: []
priority: high
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replaces the client-side worker Picker. See decision-22.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, and PROVEN IN THE PRODUCTION DATABASE.

decision-22: identity comes from the session, never from the request body.

Evidence:
- `\d workers` in production has `apple_sub text UNIQUE` — added by migration
  002_worker_identity.sql, applied 2026-07-28 18:30.
- The one production worker row has apple_sub NOT NULL. A real Apple identity is bound to a real
  worker on the live box.
- `worker_sessions(token, worker_id, expires_at, created_at)` exists with an ON DELETE CASCADE FK
  to workers; 2 rows live. Every worker route resolves identity from that table.
- Server-side eligibility: routes are declared `auth: "worker"` in server/routes/app.js and the
  Apple token is verified in server/lib/apple.js. The client-side worker Picker is gone.
- Write-up: backlog/docs/SIWA-REPORT.md.
- iOS: NFCTimeSheets/NFCTimeSheets/Auth.swift; frame docs/media/ios-signin.png.

The five production shifts were all posted by that authenticated worker, so the whole chain —
Apple sign-in, session, tag tap, shift row — has run end to end against production.

Companion path for Android is decision-26 (admin-issued enrolment code), filed as its own task;
that worker row also shows enrolment_code_redeemed_at = 2026-08-03 13:24.
<!-- SECTION:NOTES:END -->
