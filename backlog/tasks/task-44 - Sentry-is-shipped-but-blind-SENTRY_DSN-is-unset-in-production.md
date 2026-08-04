---
id: TASK-44
title: 'Sentry is shipped but blind: SENTRY_DSN is unset in production'
status: To Do
assignee: []
created_date: '2026-08-04 17:59'
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
TRIAGE 2026-08-04 (agent 2) — OPEN. Found by inspecting the live VM, read-only.

  systemctl cat nfc-api            -> EnvironmentFile=/etc/nfc/env
  sudo grep -rl SENTRY_DSN /etc/nfc/  -> no file matches
  grep -c 'SENTRY_DSN=..*' /etc/nfc/env -> 0

/etc/nfc/env holds exactly APP_KEY, DATABASE_URL and PORT. The DSN is not there, so
server/instrument.mjs starts the SDK disabled and nothing is reported.

THIS IS THE SAME ROOT CAUSE AS THE BLANK MAP AND THE MISSING BUILDING PHOTOS: secrets were
obtained and put in the psst vault (TASK-29) but never installed on the machine that needs them.
TASK-29's own notes name this task as where the Sentry half is tracked - it did not exist until
now. Three symptoms, one missing step in the deploy.

WHAT BREAKS IF NEVER DONE: a crash on clock-in is invisible. The failure mode that matters here is
silent - a worker taps, nothing happens, they shrug and go to work, and the first anyone knows is
a payroll argument weeks later. There is no error reporting to contradict them, and 5 shifts in
the database is not enough traffic for anyone to spot a pattern by eye.

NOTE THE CODE IS NOT AT FAULT: shipping inert without a DSN is exactly what decision-23 requires
('telemetry must never be required to boot and must never block a clock-in'). Do not 'fix' this by
making startup fail when the DSN is missing. The fix is one line of configuration on the VM.

ponytail: it is an env var. Do not build a secrets manager for it. Ceiling: one more hand-placed
value in /etc/nfc/env that a VM rebuild loses. Upgrade path: fold /etc/nfc/env generation into
ops/deploy.sh so map key, geocoding key and DSN are all placed by the same step.
<!-- SECTION:NOTES:END -->
