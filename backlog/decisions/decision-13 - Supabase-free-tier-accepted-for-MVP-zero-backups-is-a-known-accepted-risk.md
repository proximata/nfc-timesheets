---
id: decision-13
title: Supabase free tier accepted for MVP - zero backups is a known accepted risk
date: '2026-07-28 14:40'
status: superseded
---
## Context



## Decision



## Consequences

## MOOT via decision-16 (2026-07-28)

No Supabase project is created for 3A. The underlying risk acceptance (no backups at MVP)
did NOT carry over: VM-local Postgres owns hardware failure too, so daily pg_dump + offsite
+ tested restore is mandatory. See runbook-vm-provisioning.md section 6.
