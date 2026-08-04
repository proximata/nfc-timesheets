---
id: TASK-1
title: Provision fresh exe.dev VM with Postgres
status: Done
assignee: []
created_date: '2026-07-28 13:47'
updated_date: '2026-08-04 16:46'
labels:
  - infra
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create new exe.dev VM. Install Node 22 LTS, Postgres 16, PM2. Configure PM2 with systemd startup hook. Postgres on localhost only, password auth. Old timesheets.exe.xyz preserved as rollback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ssh <newvm>.exe.xyz connects
- [x] #2 psql -U timesheets -d timesheets connects
- [ ] #3 pm2 status shows server process
- [ ] #4 pm2 startup configured for VM restart survival
- [x] #5 Old timesheets VM preserved until 3A complete
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — DONE by live evidence.

- ssh timesheets.exe.xyz -> hostname `timesheets`. AC1 met.
- `postgresql@16-main.service  loaded active running` and `nfc-api.service  loaded active running`
  (systemctl on the VM). Postgres 16 present; DB is named `nfc`, not `timesheets`.
- AC3/AC4 (pm2) are OBSOLETE: decision-18 replaced PM2 with systemd. The equivalent evidence is
  the two units above plus `nfc-autoclose.timer` and `nfc-backup.timer` in `systemctl list-timers`.
- Secrets are in /etc/nfc/env (root:app 0640), read via systemd EnvironmentFile. Only three keys
  are set there: APP_KEY, DATABASE_URL, PORT.
- AC5: legacy JSON store survives as `legacy-backup/data.json` + `.vm-legacy-backup/data.json`.
  The old root/setsid arrangement is gone; /root is no longer world-readable.

NOT covered by this task, still open: the daily dump runs (`nfc-backup.service` -> 
/var/backups/nfc/nfc-20260804T001253Z.sql.gz, exit 0) but the offsite copy is still
`TODO(offsite)` in ops/backup/pg-backup.sh:67. Filed separately.
<!-- SECTION:NOTES:END -->
