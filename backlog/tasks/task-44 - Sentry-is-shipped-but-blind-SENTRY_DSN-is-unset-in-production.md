---
id: TASK-44
title: 'Sentry is shipped but blind: SENTRY_DSN is unset in production'
status: To Do
assignee: []
created_date: '2026-08-04 17:59'
updated_date: '2026-08-21 13:04'
labels:
  - ops
  - telemetry
dependencies: []
priority: medium
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-23 put Sentry on the API and on iOS, and the code is correct - it is written so that telemetry can never be required to boot and can never block a clock-in, which is why nobody noticed. The DSN was never placed on the production VM, so the SDK initialises disabled and every error since the deploy has gone nowhere.

server/instrument.mjs:22 - 'SENTRY_DSN unset (the state this ships in) -> the SDK is disabled. No transport, no...'

That default is right for a repo. It is wrong for the one machine that runs payroll.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SENTRY_DSN present in /etc/nfc/env on the production VM
- [ ] #2 A deliberately triggered test error appears in the Sentry project
- [ ] #3 SENTRY_ENVIRONMENT set so production is distinguishable from a laptop
- [ ] #4 The DSN is in the psst vault as well as on the VM, so a rebuild does not lose it
- [ ] #5 Confirm scrubbing still holds with a real DSN: no identityToken, X-App-Key, cookie or password_hash leaves the box
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
See TASK-224's note, verdict pass 2026-08-21: re-verified unset on the box. Nothing is blocked on this repo.
<!-- SECTION:NOTES:END -->
