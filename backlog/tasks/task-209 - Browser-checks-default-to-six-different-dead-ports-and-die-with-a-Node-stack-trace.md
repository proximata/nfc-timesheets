---
id: TASK-209
title: >-
  Browser checks default to six different dead ports and die with a Node stack
  trace
status: To Do
assignee: []
created_date: '2026-08-20 04:04'
labels:
  - tooling
  - measured
dependencies: []
priority: low
ordinal: 127000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED at 8702615. README says every browser check wants the server on :8080, and says why - it is the one loopback origin the Google Maps browser key's referrer allowlist contains. The files disagree with the README and with each other:

  8080  audit-widths audit-params audit-map-a11y audit-map-contrast check-ia-greyscale check-map-home check-merge check-reach
  8082  audit-contrast audit-keyboard audit-overlays audit-overlays2 audit-band audit-band-shape audit-german audit-phone audit-focus-ring audit-table-words check-foundation
  8083  check-clients-contracts-inventory
  8091  check-materials-account-login
  8092  check-dashboard-shifts check-filters
  8093  check-money

Run any of the second group with no env var and it does not say 'nothing is listening on :8082'. It says:

  Error: TypeError: Cannot read properties of null (reading 'focus')
      at Object.type (demo/cdp.mjs:154:7)
      at async signIn (demo/check-money.mjs:186:3)

Exit code is 1, so nothing PASSES vacuously - this is noise, not a false green, which is why it is LOW and not HIGH. But it is the same failure class server/db/check-prod-restore.mjs was fixed for at 9072a8e: an operator reads a stack trace as 'the tooling is broken', not as 'one env var away'. It cost this run two dead check-runs before the pattern was recognised.

demo/build-guard.mjs already exports assertFreshServer(base), which throws 'build-guard: nothing is listening on <base>' - the named failure this needs. The checks in the second group simply do not call it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 every demo/*.mjs browser check calls assertFreshServer(BASE) before its first navigation
- [ ] #2 running one with nothing on its port prints a one-line named failure naming the port and the command that starts the server, and exits 1 - no stack trace
- [ ] #3 the defaults are reconciled with the README: either all 8080, or each file states in a comment why it differs
- [ ] #4 the negative case is exercised: stop the server and show each changed check going red with the named message, not a TypeError
- [ ] #5 no check changes what it asserts - this is a precondition, not a new assertion
<!-- AC:END -->
