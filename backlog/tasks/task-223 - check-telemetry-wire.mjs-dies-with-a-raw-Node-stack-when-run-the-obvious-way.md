---
id: TASK-223
title: check-telemetry-wire.mjs dies with a raw Node stack when run the obvious way
status: Done
assignee: []
created_date: '2026-08-20 22:46'
updated_date: '2026-08-21 01:55'
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
- [x] #1 Running `node server/check-telemetry-wire.mjs` with no loader prints ONE line naming the exact command to run instead, and exits non-zero — no stack.
- [x] #2 The correct invocation still passes unchanged, and is written next to the checks in server/README.md.
- [x] #3 Shown red: the guard's own message is asserted, so deleting the guard fails the check rather than producing a stack again.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SECOND HALF OF THE SAME PAPERCUT, found 2026-08-21 during the break run: fixing the --import half is not enough.

  cd server && node --import ./instrument.mjs check-telemetry-wire.mjs

does NOT stack-trace. It prints four FAIL lines and exits 1:

  FAIL the SDK produced payloads at all (an empty check passes for the wrong reason)
  FAIL a rejected clock-in still produces a server transaction (401 is not dropped)
  FAIL the transaction is named by ROUTE PATTERN, not by a concrete URL
  FAIL scrubbing did not empty the payload out - it is still diagnosable
       Cannot read properties of undefined (reading 'contexts')

Every one of those is the SAME cause -- SENTRY_DSN is unset, so the SDK is disabled and emits nothing -- and the first line is the anti-vacuity guard doing its job. But four reds and a TypeError read as four broken assertions, not as one missing variable, which is exactly the failure mode AC #1 is written against.

So the guard AC #1 asks for has to cover BOTH halves: no loader, and no DSN. With the DSN the same command passes:

  cd server && SENTRY_DSN='https://check@o4509000000000000.ingest.de.sentry.io/451' node --import ./instrument.mjs check-telemetry-wire.mjs
  -> check-telemetry-wire: PASS

RELATED, and it changes the priority argument: ops/deploy.sh now installs the systemd unit and the deployed API really does run with --import (commit f5c53ed). Before that the flag was missing in production, so this check was guarding a property the box did not have. It now guards a real one. TASK-224 is the remaining half -- there is still no DSN in production.

FIXED. Top-of-file guard in check-telemetry-wire.mjs now checks Sentry.getClient() AND client.getOptions().dsn before running any case; either miss prints ONE 'check-telemetry-wire: run with: ...' line to stderr and exit(1), no stack. Verified by hand: no loader, loader+no DSN, and the correct invocation (PASS, exit 0). Regression-proofed in check-api.js: two new cases run both wrong invocations as children and assert exactly one line containing 'run with:' and no 'AssertionError'/'at file://' — deleting the guard fails these, not just check-telemetry-wire.mjs itself. Documented next to the other checks in server/README.md.
<!-- SECTION:NOTES:END -->
