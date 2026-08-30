---
id: TASK-322
title: >-
  android/checks/run.sh aborts on the first failing check, so 7 later checks
  silently never run
status: To Do
assignee: []
created_date: '2026-08-29 23:03'
labels:
  - android
  - checks
dependencies: []
priority: medium
ordinal: 240000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
run.sh is 'set -euo pipefail' and CoreCheck is the FIRST thing it executes. At HEAD CoreCheck
exits 1 (the decision-63 code-length drift, TASK-321), and the ENTIRE remainder of the suite is
skipped without a word:

  observed, whole stdout of 'bash android/checks/run.sh' at HEAD:
    FAIL: the alphabet is 32 characters, i.e. exactly 5 bits
    FAIL: code length: server 5 vs client 8
    (exit 1)

Never reached: known-tags-check, tag-writer-check, raw-tag-io-check, manifest-check.sh,
verify-no-shift-check.sh (decision-47's 'the test scan cannot open a shift'), reader-armed-check.sh,
operator-401-check. Seven checks, including two that guard decision-level invariants, reported
nothing at all - and a reader sees two FAILs about an unrelated subject and assumes the rest is fine.

WHY IT MATTERS HERE: this run's Android lane reported 'all gates green'. That was true at bd00e89
and false at HEAD, and the suite's own shape is what made the difference invisible.

FIX SHAPE: run every check, accumulate failures, exit non-zero at the END with a summary naming
which checks ran and which failed. Keep 'set -u'; drop the early abort for the check invocations
only (a missing kotlinc / failed download must still abort - that is a broken toolchain, not a
failing assertion).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a failing CoreCheck no longer prevents the other 7 checks from running
- [ ] #2 the suite prints a final summary listing every check and its result, and exits non-zero if any failed
- [ ] #3 a genuinely broken toolchain (no kotlinc, failed jar fetch) still aborts immediately
- [ ] #4 demonstrated by breaking one assertion and seeing the other checks still report
<!-- AC:END -->
