---
id: TASK-332
title: >-
  check-close-flag.mjs and check-phone-namespace.mjs run in no CI pipeline, and
  check-close-flag.mjs breaks under server-deploy's working-directory:server
  convention
status: To Do
assignee: []
created_date: '2026-08-30 05:02'
labels:
  - 'for agent: pick up in next server/CI workflow'
dependencies: []
priority: medium
ordinal: 250000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by blockers_321_328_330_331's verify pass while confirming CI wiring (TASK-322's second half). Both scripts pass when run standalone but neither server-deploy.yml nor any other pipeline invokes them, so a regression in shift-close-flag behaviour or phone-namespace handling would ship silently. Separately, check-close-flag.mjs reads server/routes/app.js with a repo-root-relative path, so running it the same way server-deploy.yml runs the other two checks (working-directory: server) throws ENOENT instead of a real pass/fail - it only works invoked from the repo root today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both scripts run as part of server-deploy.yml's checks step (or their own step), failing the deploy on a red line
- [ ] #2 check-close-flag.mjs's path resolution fixed to work from server-deploy.yml's working-directory:server convention rather than requiring repo-root invocation
<!-- AC:END -->
