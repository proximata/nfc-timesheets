---
id: TASK-223
title: check-telemetry-wire.mjs dies with a raw Node stack when run the obvious way
status: To Do
assignee: []
created_date: '2026-08-20 22:46'
labels:
  - server
  - checks
  - papercut
dependencies: []
priority: low
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED 2026-08-21 while re-running the standing suite. `node server/check-telemetry-wire.mjs` — which is how every other check in this repo is invoked — exits 1 with a 12-line AssertionError stack and the message 'instrument.mjs must be loaded with --import, or nothing is instrumented'. It is CORRECT (Sentry.getClient() really is undefined without the loader) and it is right to fail closed. But it reads as a broken check, and an agent re-running the suite records it as a failure: this run did, and had to read the source to find out it was an invocation error.

It needs: SENTRY_DSN=... node --import ./instrument.mjs check-telemetry-wire.mjs
With that, it passes.

Same shape as TASK-218 (migrate.js burying a refusal under a stack trace): the check knows exactly what is wrong and prints a stack instead of saying it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Running `node server/check-telemetry-wire.mjs` with no loader prints ONE line naming the exact command to run instead, and exits non-zero — no stack.
- [ ] #2 The correct invocation still passes unchanged, and is written next to the checks in server/README.md.
- [ ] #3 Shown red: the guard's own message is asserted, so deleting the guard fails the check rather than producing a stack again.
<!-- AC:END -->
