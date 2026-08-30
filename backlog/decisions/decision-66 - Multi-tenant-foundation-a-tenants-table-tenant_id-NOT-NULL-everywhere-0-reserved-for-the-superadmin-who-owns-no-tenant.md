---
id: decision-66
title: >-
  Multi-tenant foundation: a tenants table, tenant_id NOT NULL everywhere, 0
  reserved for the superadmin who owns no tenant
date: '2026-08-30 04:57'
status: accepted
---
## Context

TASK-315's research already concluded the right shape: row-level `tenant_id` enforced by
Postgres RLS, not schema-per-tenant or DB-per-tenant. This decision ships the SCHEMA
FOUNDATION only — the column and the one real tenant — not RLS enforcement and not a
superadmin UI. Those are named as explicit future work, not built here.

## Decision

`tenants(id, name, created_at)`. Row `id = 0` is a fixed **sentinel**, seeded by
migration, meaning "no tenant" — it is never a real operating tenant and never gets a
second row. The migration also seeds the one real tenant, Schimmer & Glanz, as `id = 1`.

`tenant_id` becomes **NOT NULL**, FK'd to `tenants(id)`, added to `admins`, `workers`,
`locations`, `zones`, and `shifts`. Every existing row backfills to `tenant_id = 1` in the
same migration. Positive id = real tenant; `0` is reserved exclusively for superadmin
rows.

`admins.role` (decision-57: `admin` | `flags`) gains a third value, `superadmin`, with a
CHECK tying role to tenant: `role = 'superadmin' <=> tenant_id = 0`. A superadmin row can
never belong to a real tenant and a real tenant's admin can never hold the superadmin
role — the constraint makes the two facts one fact.

**Not built in this decision**, named explicitly so nobody assumes it shipped:
- Postgres RLS / `SET app.tenant_id` enforcement. Every route still implicitly operates
  within the one real tenant because there is currently only one — no behavioral change.
- A superadmin panel UI (tenant cards, click-to-view-as-tenant). `action_log` (decision-65)
  already gives a superadmin a color-coded audit view; a full impersonation UI is its own
  future decision once this schema is live and boring.
- A second tenant. This decision creates the column and the sentinel, not a second
  customer.

## Consequences

Inert scaffolding today, same posture as decision-57's flags before their first real use —
value only lands once (a) a second tenant row exists and (b) every route actually filters
by `tenant_id` or RLS enforces it. Until then this is a no-op migration plus one new CHECK
constraint. `admins.tenant_id` being NOT NULL (rather than nullable, which was the
initially-considered shape) means the superadmin case needed a real sentinel row instead
of NULL — cheaper to reason about (no route needs a NULL-tenant special case) at the cost
of one reserved id forever.
