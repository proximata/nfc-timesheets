---
id: TASK-224
title: >-
  Telemetry: production has NEVER had Sentry loaded, and journald on one VM is
  the whole of observability
status: To Do
assignee: []
created_date: '2026-08-21 00:08'
updated_date: '2026-08-21 03:23'
labels: []
dependencies: []
priority: high
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Sentry SDK has been shipped and inert since decision-23. Both halves were broken, and only the smaller half was known.

MEASURED 2026-08-20 on schimmer-glanz.exe.xyz:
  /proc/<pid>/cmdline = /usr/bin/node /srv/nfc/server.js   -- NO --import
  SENTRY_DSN          = unset in /etc/nfc/env

instrument.mjs's own header says --import is required, not stylistic: 'import "./instrument.mjs" from inside server.js runs too late: pg and node:http are already loaded and never get instrumented.' Without the flag the SDK is not in the process at all. So the one action everybody believed would turn telemetry on -- set SENTRY_DSN, restart -- would have produced exactly nothing, and the next person to look would have concluded Sentry itself was broken.

THE --import HALF IS NOW FIXED (commit f5c53ed): ops/deploy.sh step 5b installs the unit, ops/check-unit-drift.sh asserts the running argv, and check-unit-drift-mutants.sh shows it red against the literal unit production was running. THIS TASK IS THE REMAINING HALF: there is still no DSN, so nothing leaves the box.

WHAT THAT COSTS, measured rather than asserted. ops/break-infra.sh section 2 stopped Postgres and posted a real clock-in. The complete record of that failed clock-in, anywhere in the world:

  [500] POST /shifts/open: connect ECONNREFUSED 127.0.0.1:5432

One line, in journald, on the same VM as the database that failed, not aggregated, with nothing watching it. journalctl --disk-usage is 144M under the default SystemMaxUse (10% of /var), so it rotates in roughly a month. There is no monitoring agent of any kind on the box: the running services are cron, dbus, nfc-api, postgresql, journald, logind, timesyncd, user@1000. That is the list.

CONSEQUENCE: a clock-in that fails in a stairwell is discovered by a human reading a phone screen and telephoning the office. Nobody finds out that a tap failed unless a cleaner says so, and a cleaner who is not paid for a shift finds out at the end of the month.

ACCEPTANCE:
- a DSN in the psst vault under the server tag, synced by ops/sync-secrets.sh (never hand-edited into /etc/nfc/env)
- an error deliberately raised on production arrives in the Sentry project, with a screenshot of the event
- shown RED: with the DSN removed, the same deliberate error produces no event
- decision-23's scrubbing verified on that real event: no cookie, no identity token, no email, no name -- only w=<id>
- server/check-telemetry-wire.mjs runs in the deploy (see TASK-223, which is why it cannot run at all today)

MUST NOT REGRESS: telemetry must never be required to boot and must never block a clock-in (decision-23). instrument.mjs must stay throw-free -- Restart=always + RestartSec=5 turns a throw here into a crash loop that takes the API down for telemetry.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERDICT PASS 2026-08-21 — half of this is now impossible to get wrong, and the remaining half is confirmed still open.

ops/check-unit-drift.sh against production, this run:
  ok: the running process's argv IS the repo's ExecStart: /usr/bin/node --import /srv/nfc/instrument.mjs /srv/nfc/server.js
  ok: instrument.mjs is loaded via --import, so a DSN would actually take effect
  ok: the API runs as 'app' — a nologin system account

STILL OPEN, verified directly: SENTRY_DSN is unset on the box. `sudo grep -c '^SENTRY_DSN=' /etc/nfc/env` -> 0. The SDK is in the process and reports nowhere; journald remains the whole of observability.

The wire check itself is green when handed a DSN: `cd server && SENTRY_DSN=… node --import ./instrument.mjs check-telemetry-wire.mjs` -> PASS, including 'nothing forbidden survives on the wire' and 'the phone's trace is CONTINUED'. So the only thing between here and telemetry is the DSN in /etc/nfc/env and a restart.
<!-- SECTION:NOTES:END -->
