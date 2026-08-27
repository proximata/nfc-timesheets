---
id: TASK-292
title: >-
  Backend: feature_flags table + GET /flags + admin role column + admin flags
  routes
status: Done
assignee: []
created_date: '2026-08-27 10:38'
updated_date: '2026-08-27 16:10'
labels:
  - server
  - decision-57
dependencies: []
priority: medium
ordinal: 210000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 migration adds feature_flags(name PK, enabled bool default false, updated_at, updated_by) and admins.role text default 'admin' check in ('admin','flags')
- [x] #2 GET /flags (auth worker) returns {name: bool} for all rows
- [x] #3 GET /admin/flags and PATCH /admin/flags/:name accept role admin OR flags; every other existing admin route still 401/403s a flags-role session exactly as it would an unauthenticated one
- [x] #4 one fun_shift_screen row seeded via migration, enabled=false
- [x] #5 check-api.js covers: worker GET /flags; flags-role session allowed on /admin/flags, refused on an existing admin-only route (e.g. GET /admin/workers); admin-role session unaffected
- [x] #6 a second admin row (role=flags) inserted directly via SQL on production is NOT part of this task - that is a manual follow-up once this ships
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-296 review gate, 2026-08-27: verified independently, PASS.
Migration 015 applied cleanly to a real Postgres (demo DB): admins.role landed NOT NULL
DEFAULT 'admin' CHECK IN ('admin','flags'), feature_flags created, fun_shift_screen seeded
false, ON CONFLICT DO NOTHING so a re-run cannot flip a live flag. requireAdminSession's
allowedRoles=['admin'] default is what makes every existing route admin-only by construction,
and it fails 401 (not 403) so the scoped account cannot enumerate routes. GET /flags is
auth:'worker' - confirmed 401 with an app key but no worker session, 200 with one, and the
body is a flat name->bool map with no updated_by (an admin email must not reach a handset).
check-api.js re-run: the whole decision-57 block green, incl. 8 admin routes compared
byte-for-byte against the anonymous answer. Live end-to-end on an emulator: admin PATCH
/admin/flags/fun_shift_screen -> phone's next roster pass -> shared_prefs/flags.xml
value=true, and back to false. The one check-api failure in the file is TASK-280's
pre-existing SMS telemetry case, reproduced identically at f628b54.
<!-- SECTION:NOTES:END -->
