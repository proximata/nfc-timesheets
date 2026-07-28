---
id: decision-12
title: Explore Supabase + Edge Functions as potential replacement for bare Postgres + Node on VM
date: '2026-07-28 14:05'
status: rejected
---
## Context

Current plan: Postgres + Node.js on exe.dev VM. Concern: single VM = single point of failure for API. Supabase offers managed Postgres + Edge Functions (Deno-based serverless) co-located with the database. Combined with Vercel for frontend, this could eliminate the VM entirely.

## Decision

RESEARCH REQUIRED before accepting. Key questions:
1. Can all API features (shift CRUD, roster, admin auth, 8h cron job, AASA serving) run as Edge Functions?
2. Edge Functions are ephemeral — can we run a cron-equivalent (Supabase has pg_cron)?
3. Supabase free tier limits: enough for pilot?
4. Latency: Supabase region selection (need EU/Vienna proximity)?
5. AASA file serving: can Supabase/Vercel serve it with correct Content-Type?
6. Migration path: if Supabase doesn't fit, how easy to fall back to VM?

## Consequences

If accepted:
- No VM to maintain (zero ops)
- Database backups automatic
- Edge Functions scale to zero (free when idle)
- Vendor lock-in on Supabase (mitigated: standard Postgres, functions are just Deno)

If rejected:
- Stay with decision-1 (VM + PM2 + Postgres)
- Accept single-VM reliability ceiling

## RESOLVED: deferred, not rejected on merit (2026-07-28)

Research complete: `research/supabase-vs-vm.md`. Supabase maps 10/12 features natively but
cannot serve AASA (fixed URL namespace, no root-path control). Combined with decision-15
(tags stay on exe.xyz) and decision-13 (free tier = no backups), the case collapsed.
See decision-16. Revisit at first paying client.
