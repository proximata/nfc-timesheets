---
id: TASK-169
title: deploy.sh must remove stale test material it now excludes
status: To Do
assignee: []
created_date: '2026-08-18 06:20'
labels:
  - ops
  - safety
dependencies: []
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
rsync --delete does NOT delete files matched by --exclude: excluded files are protected on the receiver. So when deploy.sh gained '--exclude check-*.js --exclude check-*.mjs --exclude db/seed.sql', it stopped SENDING them and simultaneously guaranteed the copies already on the VM could never be removed.

Found live on 2026-08-18: /srv/nfc/check-api.js, /srv/nfc/check-close-flag.mjs and /srv/nfc/db/seed.sql were sitting next to the payroll database. check-api.js contains 2 CREATE/DROP SCHEMA statements and hardcodes no database name — it reads DATABASE_URL, which on that box points at live payroll data. Anyone (or any agent) running it there would create and drop schemas in production.

Those three were deleted by hand. db/check-migrate.js is still there, same class, same reason.

DO: add an explicit removal step to ops/deploy.sh so the exclusion list and the box agree — the exclusion prevents arrival, and the removal handles what already arrived. Keep db/migrate.js and db/migrations (deploy runs them).

AC: after a deploy, no check-*.js, check-*.mjs, *.test.js or seed.sql exists anywhere under /srv/nfc. Prove it by planting a dummy check-planted.js on the VM, deploying, and showing it is gone. A test whose negative case cannot fail is not a test, so show the RED first: confirm the dummy survives a deploy BEFORE the fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 no check-*.js, check-*.mjs, *.test.js or seed.sql under /srv/nfc after a deploy
- [ ] #2 planted dummy file proven to survive before the fix, and proven removed after
<!-- AC:END -->
