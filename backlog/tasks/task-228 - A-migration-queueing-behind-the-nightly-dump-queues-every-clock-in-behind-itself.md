---
id: TASK-228
title: >-
  A migration queueing behind the nightly dump queues every clock-in behind
  itself
status: To Do
assignee: []
created_date: '2026-08-21 00:10'
labels: []
dependencies: []
priority: medium
ordinal: 146000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
nfc-backup.timer fires at 00:13 daily. ops/deploy.sh runs server/db/migrate.js whenever anyone deploys. Nothing schedules around anything, and neither sets a lock timeout.

THE MECHANISM, and it is locks rather than corruption: pg_dump takes ACCESS SHARE on every table and holds it for the whole dump. A migration's ALTER TABLE needs ACCESS EXCLUSIVE and cannot get it while that is held, so it queues — and Postgres then queues EVERY LATER QUERY ON THAT TABLE BEHIND THE QUEUED ALTER, because lock requests are ordered. A migration that merely waits therefore stalls clock-ins for as long as the dump takes.

MEASURED 2026-08-20 on production (ops/break-timers.sh section 3), by holding ACCESS EXCLUSIVE on the shifts table for 12s:
  the dump queued ~11s for its lock, and still produced a VERIFIED dump — it waited, it did not truncate, it did not fail the unit
  a SELECT on the shifts table issued inside the window waited 9s for an answer

That SELECT is the query a clock-in makes.

WHY THIS IS MEDIUM AND NOT HIGH: today the database is 7 KB and the dump is milliseconds, so the window is invisible. The severity grows with the data. The day this holds a year of payroll for twenty cleaners, a deploy at the wrong minute is a stalled door.

FIX, cheap and standard:
- SET lock_timeout in server/db/migrate.js (a few seconds) so a migration that cannot get its lock FAILS THE DEPLOY loudly instead of holding the queue open. A deploy that stops is recoverable; a stalled clock-in at a door is not observable from here at all.
- optionally move nfc-backup.timer away from any hour a human deploys in, though the lock_timeout is the real fix and the schedule is only a reduction in odds.

ACCEPTANCE:
- shown RED first: with an ACCESS EXCLUSIVE lock held, a migration run aborts on lock_timeout rather than waiting, and says so
- and GREEN: with no lock held, the identical migration applies normally
- ops/break-timers.sh section 3 re-run and its measured numbers updated in backlog/docs/RELIABILITY.md
<!-- SECTION:DESCRIPTION:END -->
