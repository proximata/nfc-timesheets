---
id: TASK-293
title: 'Admin web: Flags page (list + toggle), reachable by admin and flags roles'
status: To Do
assignee: []
created_date: '2026-08-27 10:38'
updated_date: '2026-08-27 10:44'
labels:
  - web
  - decision-57
dependencies:
  - TASK-292
priority: low
ordinal: 211000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 new /flags admin page lists feature_flags rows with a toggle each, calling PATCH /admin/flags/:name
- [ ] #2 nav entry visible to both admin roles; every OTHER existing admin nav item/page still refuses a flags-role session with the same treatment as logged-out
- [ ] #3 de.json/en.json get the new keys, pnpm verify passes
<!-- AC:END -->
