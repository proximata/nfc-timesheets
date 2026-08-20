---
id: TASK-218
title: >-
  migrate.js buries a migration's refusal under a 12-line Node stack on the
  APPLY path, while --dry-run prints one clean line
status: To Do
assignee: []
created_date: '2026-08-20 13:03'
labels:
  - ops
  - dx
dependencies: []
ordinal: 136000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED this session against a database restored from the production dump, at the exact moment a deploy would hit it (backlog/docs/VERDICT-W1-DB.md section 2.1).

  DATABASE_URL=postgres:///scratch node server/db/migrate.js        -> exit 1
  psql:<stdin>:62: ERROR:  1 worker(s) have no hourly rate; refusing to invent one.
  HINT:  Set every rate on /workers/ (or remove the leftover row), then re-run migration 006.
  CONTEXT:  PL/pgSQL function inline_code_block line 6 at RAISE
  node:internal/errors:985
    const err = new Error(message);
                ^
  Error: Command failed: psql postgres:///scratch -v ON_ERROR_STOP=1 -q -t -A -1 -f -
      at genericNodeError (node:internal/errors:985:15)
      ... 8 more frames, status: 3, signal: null, output: [ null, '', null ], pid: 89199

The two lines the operator has to act on are correct, present, and then pushed off the top of a small terminal by an execFileSync stack that says nothing.

THE FIX ALREADY EXISTS ELSEWHERE IN THE SAME FILE. migrate.js's --dry-run branch catches, prints 'migrate --dry-run: 006_zones_revenue_rates.sql does NOT apply. Nothing was written.' and exits 1, with the reasoning written in its own comment: a Node stack trace on top of psql's message buries the one line a human has to act on, and this runs as the first step of a deploy. The APPLY branch (line 104) has no such catch.

NOT AN OUTAGE AND NOT A SILENT FAILURE: exit code is 1, nothing is written, schema_migrations records nothing, and the database is left exactly as it was. It is the D7 class from VERIFY-FINAL and the class 9072a8e fixed in check-prod-restore.mjs: an operator reads a stack trace as 'the tooling is broken' rather than 'the migration refused, and here is why'. It matters because a REFUSAL IS A DESIGNED OUTCOME here (decision-41: 006 refuses rather than inventing a wage), so this is the normal path on the first 006 deploy, not an edge case.

WHAT TO DO. Wrap the apply call the same way --dry-run is wrapped: catch, print 'migrate: <file> does NOT apply. Nothing was written.' and exit 1. psql's own ERROR and HINT already went to stderr verbatim through stdio inherit, so nothing is lost. Roughly five lines, no new dependency.

ACCEPTANCE, negative case seeded: on a scratch database carrying one worker with hourly_rate_cents = 0, node server/db/migrate.js must exit 1, must print the ERROR, the HINT and the new named line, and must print NO 'node:internal' frame. Assert the absence of the stack, not just the presence of the message - and show the assertion RED against today's code first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a refused migration on the apply path prints the psql ERROR, the HINT and one named line, and no Node stack frame
- [ ] #2 exit code stays 1 and schema_migrations still records nothing
- [ ] #3 the check asserts the ABSENCE of 'node:internal' and is shown RED against today's migrate.js first
<!-- AC:END -->
