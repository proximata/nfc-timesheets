---
id: decision-1
title: No Docker - PM2 + systemd on exe.dev
date: '2026-07-28 13:51'
status: accepted
---
## Context

Owner explicitly dislikes Docker. Current deploy is `setsid node server.js` via a bash script — no process manager, no restart on crash. Need reliable process management for production pilot.

## Decision

Use PM2 with `pm2 startup` (systemd hook) on the exe.dev VM. Single VM hosts everything: Node server + Postgres + Next.js web admin.

## Consequences

- Simple ops: `pm2 restart`, `pm2 logs`, `pm2 monit`
- No container isolation — acceptable for single-tenant small crew
- Upgrade path: if VM resource limits hit, split to two VMs (server + DB) before considering containers
