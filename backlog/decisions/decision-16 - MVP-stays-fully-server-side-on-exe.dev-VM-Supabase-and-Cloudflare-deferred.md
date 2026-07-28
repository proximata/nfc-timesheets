---
id: decision-16
title: MVP stays fully server-side on exe.dev VM - Supabase and Cloudflare deferred
date: '2026-07-28 14:50'
status: accepted
---
## Context

`research/decision-brief.md` recommended a hybrid: Supabase Postgres + Hono Edge Function,
Cloudflare Worker for AASA, VM retired. Then two things happened:

1. **decision-15** kept NFC tags on `timesheets.exe.xyz`. A Cloudflare Worker can only serve
   a zone in our own CF account, and `exe.xyz` is exe.dev's. So AASA had to stay on the VM
   regardless — the VM could never be fully retired
   (see `backlog/docs/BLOCKER-aasa-host-vs-cloudflare.md`).
2. **decision-13** accepted the Supabase **free** tier, which has **zero backups**. That
   removed the single strongest argument for managed Postgres over Postgres-on-VM. We would
   have taken on a vendor, a network hop, and a new runtime to get a database with the same
   backup story as the one we already have.

Owner's call: not ready for "cloud maxing" this iteration. Keep logic server-side, revisit
Cloudflare later.

## Decision

**Everything runs on the exe.dev VM for 3A:**

- Node API (existing shape, rewritten to Postgres per decision-2)
- Postgres **local to the VM**, unix socket, not publicly bound
- AASA + `assetlinks.json` + `/t` served by the same server (decision-4 stands)
- Next.js admin panel **static-exported and served from the same VM** — not Vercel, not
  Cloudflare Pages
- 8h auto-close via a **systemd timer** running SQL, not `pg_cron` and not an in-process
  interval

One box, one deploy, one thing to keep alive. Provisioning follows
`backlog/docs/runbook-vm-provisioning.md`.

## Consequences

**Supersedes decision-11** (frontend on Vercel). Also sidesteps the Vercel Hobby
non-commercial ToS problem entirely — nothing deploys to Vercel. The Vercel CLI auth and
Google Maps browser-key referrer restriction (`*.vercel.app`) both need retargeting to the
VM hostname before TASK-16 ships.

**Defers decision-12** (Supabase) and **decision-14** (Cloudflare Pages) — both remain
valid options, neither is rejected on technical grounds. Revisit trigger: first paying
client, or when the VM becomes the operational bottleneck.

**Moots decision-13** (Supabase free tier) — no Supabase project gets created.

**Reaffirms decision-1** (no Docker), **decision-2** (Postgres over JSON store),
**decision-4** (AASA on exe.xyz). decision-4 survived the entire research cycle unchanged;
the brief only wanted to move it because it assumed a company-owned domain we do not have.

**The backup gap is now ours to close.** Supabase free would have given us nothing here
either, so this is not a regression — but a VM with no backups is worse than managed-with-no-
backups, because we also own hardware failure. `runbook-vm-provisioning.md` §6 specifies
daily `pg_dump` + offsite copy + one tested restore. **That is not optional for payroll
data** and is the one piece of this decision that must not be deferred with the rest.

**Migration cost if we go hybrid later is low and was designed in:** the API is a plain REST
surface over Postgres. Moving it to Supabase means porting route handlers to Hono/Deno and
`pg_dump | psql` into managed Postgres. Keeping the API framework-light in TASK-3 preserves
that option cheaply.
