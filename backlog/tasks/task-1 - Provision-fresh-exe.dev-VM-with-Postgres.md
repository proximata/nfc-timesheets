---
id: TASK-1
title: Provision fresh exe.dev VM with Postgres
status: Done
assignee: []
created_date: '2026-07-28 13:47'
updated_date: '2026-08-27 07:31'
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
Audit 2026-08-27: AC3/AC4 (pm2 status/startup) are moot, not a gap - decision-18 replaced PM2 with systemd project-wide; the goal (server survives VM restart) is achieved via the nfc-api systemd unit instead. Left unchecked deliberately.
<!-- SECTION:NOTES:END -->
