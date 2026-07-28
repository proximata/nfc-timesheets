---
id: TASK-3
title: Rewrite server from JSON store to Postgres
status: To Do
assignee: []
created_date: '2026-07-28 13:48'
updated_date: '2026-07-28 14:46'
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
- [ ] #1 All existing API endpoints return same shape responses
- [ ] #2 iOS app works without changes against new server
- [ ] #3 data.json no longer read or written
- [ ] #4 Concurrent POST /shifts without data loss
- [ ] #5 PM2 restarts dont lose data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CONFIRMED Node + local Postgres (decision-16). Supabase/Hono deferred, not rejected.

KEEP THE API FRAMEWORK-LIGHT. This is the one design constraint carried over from the research
cycle: the migration path to Supabase/Edge later is cheap only if route handlers stay thin and
portable. Plain node:http or a minimal router; no heavy framework coupling, no ORM lock-in.
Use node-postgres (pg) with plain SQL.

Endpoints (unchanged from original scope):
  GET  /roster                  workers + locations
  POST /shifts                  receive completed shift
  GET  /shifts/unresolved       shifts needing worker correction (decision-10 flow)
  GET  /admin/data              aggregated admin view
  POST|DELETE /admin/workers    worker CRUD + hourly rates
  POST|DELETE /admin/locations  location CRUD
Auth: X-App-Key header app-level, X-Admin-Pin for admin ops.

Same process also serves AASA + assetlinks + /t (TASK-4) and the static admin export
(TASK-14). One box, one deploy.

Read secrets from /etc/nfc/env via systemd EnvironmentFile. Never hardcode. The current
server hardcodes ADMIN_PIN - do not carry that over.

Validate all input at the trust boundary: shift timestamps, worker IDs, location IDs from
NDEF URIs. Tags are UNLOCKED per decision-15, so a tag's location ID is attacker-controllable
in principle - validate it against the locations table, never trust it blind.
<!-- SECTION:NOTES:END -->
