---
id: TASK-217
title: >-
  A scratch copy of the client's database survived every cleanup: dropdb --force
  does not remove a template-flagged database
status: To Do
assignee: []
created_date: '2026-08-20 13:02'
labels:
  - ops
  - security
  - checks
dependencies: []
ordinal: 135000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
FOUND while cleaning up after this session's verification run (backlog/docs/VERDICT-W1-DB.md section 9).

WHAT WAS ON THIS LAPTOP. Database w1v_prod: a restored production dump at 5 migrations, carrying the client's admin row, left by the run whose agent died before reporting. It refused to drop:

  dropdb --force w1v_prod
  ERROR:  cannot drop a template database
  SELECT datname, datistemplate FROM pg_database WHERE datname='w1v_prod'  ->  w1v_prod | t

Cleared with UPDATE pg_database SET datistemplate = false, then dropped. Two more (w1v_a, w1v_b) and portal_smoke_69166 dropped alongside it; the last had been named in VERIFY-FINAL section 8 and had outlived that report.

WHY IT MATTERS AND WHY IT IS NOT MERELY HOUSEKEEPING. Every check in this tree tears down with dropdb --if-exists (some with --force), and the house rule since 9072a8e is that a failed pre-deploy check must not leave a copy of the client's payroll on a laptop. A template-flagged database defeats that teardown entirely: the drop FAILS, the code path prints a warning, and a warning is not a stop. The copy then survives indefinitely, through every subsequent run's cleanup.

Nothing in this tree sets datistemplate, so the flag most likely arrived from a CREATE DATABASE ... TEMPLATE or a hand edit in a dead run. The point is not how it got set; it is that the teardown cannot cope with it and reports success-with-a-warning.

WHAT TO DO. In the shared teardown used by check-prod-restore.mjs, check-field-wire.mjs, check-phone-namespace.mjs and ops/check-reset-w1.mjs: on a failed drop, clear datistemplate and retry ONCE, and if it still fails, exit NON-ZERO naming the database rather than warning. A check that cannot prove it removed the client's data has not finished.

ACCEPTANCE EVIDENCE, and the negative case must be seeded: create a scratch database, set datistemplate = true, run the teardown, and show it BOTH removing the database AND, with the retry deliberately disabled, exiting non-zero and naming it. A check whose negative case cannot fail is not a check.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a teardown that cannot drop a scratch database exits NON-ZERO and names it, instead of warning
- [ ] #2 a template-flagged scratch database is cleared and dropped by the teardown, shown on a seeded case
- [ ] #3 the negative case is demonstrated RED first: retry disabled, teardown exits non-zero
<!-- AC:END -->
