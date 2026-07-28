---
id: TASK-1
title: Provision fresh exe.dev VM with Postgres
status: To Do
assignee: []
created_date: '2026-07-28 13:47'
updated_date: '2026-07-28 14:46'
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
- [ ] #1 ssh <newvm>.exe.xyz connects
- [ ] #2 psql -U timesheets -d timesheets connects
- [ ] #3 pm2 status shows server process
- [ ] #4 pm2 startup configured for VM restart survival
- [ ] #5 Old timesheets VM preserved until 3A complete
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
CONFIRMED unchanged by research cycle (decision-16). Provision exe.dev VM with LOCAL Postgres.

No Supabase. Follow backlog/docs/runbook-vm-provisioning.md - it is the reusable procedure:
  1. non-root 'app' user, ufw, fail2ban
  2. Node 22 + Postgres 16 + pnpm via corepack
  3. Postgres on unix socket / 127.0.0.1 ONLY - verify with: ss -tlnp | grep 5432
  4. secrets: psst --tag server export | ssh <host> 'install -m 0640 -o root -g app /dev/stdin /etc/nfc/env'
     (do NOT scp the .psst directory - it is plaintext at rest and ships the whole vault)
  5. systemd unit, not PM2
  6. MANDATORY: daily pg_dump + offsite copy + ONE TESTED RESTORE

Item 6 is not deferrable. decision-13 accepted 'no backups' only in the context of managed
Supabase; on a VM we also own hardware failure, so the risk is strictly worse. Payroll data.

Existing VM state (from earlier recon): Node 22.23.1, 7.7GB RAM, 23GB free, server running as
root from /root/server.js via setsid, ADMIN_PIN=<REDACTED-legacy-PIN>, PORT=80, no Postgres, no systemd
service. Decide: rebuild clean per runbook (preferred - current setup runs as root) vs
retrofit. Existing JSON data is throwaway test data, no migration needed.
<!-- SECTION:NOTES:END -->
