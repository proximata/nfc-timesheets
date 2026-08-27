---
id: TASK-292
title: >-
  Backend: feature_flags table + GET /flags + admin role column + admin flags
  routes
status: To Do
assignee: []
created_date: '2026-08-27 10:38'
labels:
  - server
  - decision-57
dependencies: []
priority: medium
ordinal: 210000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 migration adds feature_flags(name PK, enabled bool default false, updated_at, updated_by) and admins.role text default 'admin' check in ('admin','flags')
- [ ] #2 GET /flags (auth worker) returns {name: bool} for all rows
- [ ] #3 GET /admin/flags and PATCH /admin/flags/:name accept role admin OR flags; every other existing admin route still 401/403s a flags-role session exactly as it would an unauthenticated one
- [ ] #4 one fun_shift_screen row seeded via migration, enabled=false
- [ ] #5 check-api.js covers: worker GET /flags; flags-role session allowed on /admin/flags, refused on an existing admin-only route (e.g. GET /admin/workers); admin-role session unaffected
- [ ] #6 a second admin row (role=flags) inserted directly via SQL on production is NOT part of this task - that is a manual follow-up once this ships
<!-- AC:END -->
