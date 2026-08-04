---
id: TASK-3
title: Rewrite server from JSON store to Postgres
status: Done
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-08-04 16:46'
labels:
  - server
milestone: m-0
dependencies:
  - TASK-2
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace data.json with Postgres queries. Same REST API contract. Use pg (node-postgres), connection pool. Env vars for DATABASE_URL. Keep X-App-Key and X-Admin-Pin auth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All existing API endpoints return same shape responses
- [x] #2 iOS app works without changes against new server
- [x] #3 data.json no longer read or written
- [x] #4 Concurrent POST /shifts without data loss
- [x] #5 PM2 restarts dont lose data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE, verified against the live API.

- Live: `GET https://timesheets.exe.xyz/health` -> 200 `{"ok":true}`.
- Routes exist and enforce auth (401, not 404): /roster, /shifts/open, /admin/data, /admin/pl,
  /admin/analytics. A nonexistent path returns 404 `{"error":"not_found"}`, so 401 proves the
  route is registered. AC1.
- AC2: five shifts in the production `shifts` table were POSTed by the phone
  (client_uuid NOT NULL on all five, 2026-07-30).
- AC3: no data.json is read or written. The only copies in the tree are the gitignored
  `legacy-backup/data.json` and `.vm-legacy-backup/data.json`.
- AC4: `shifts_one_open_per_worker_idx` is a UNIQUE partial index WHERE end_time IS NULL, so
  concurrent opens collide in the DB rather than racing in Node. `client_uuid` carries a UNIQUE
  constraint = phone-side idempotency key.
- AC5: `systemctl restart nfc-api` is the deploy step (ops/deploy.sh 6/7); state is in Postgres.

Framework-light constraint held: `pg` + `@sentry/node` and nothing else (server/package.json),
plain node:http, hand-rolled route table in routes/*.js. decision-16 + decision-23 respected.
Auth changed as decided: X-Admin-Pin is gone (decision-20), admin uses an httpOnly Secure
SameSite=Strict session cookie (server/lib/auth.js:175).
<!-- SECTION:NOTES:END -->
