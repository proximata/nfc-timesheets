---
id: decision-65
title: >-
  Action ledger: an append-only audit log records who did what and why; admin
  web surfaces it, color-coded, superuser only
date: '2026-08-30 04:57'
status: accepted
---
## Context

The owner asked for an immutable ledger that CAUSES every entity's creation/archival —
event sourcing as the schema's primary write model, with every route rewritten to
write-ledger-then-apply and every entity FK'd back to the log row that produced it.

Rejected as stated. That is a from-scratch rewrite of how this app persists data: every
one of the ~30 existing routes (openShift, closeShift, upsertWorker, resolveZone,
reassignBuilding, ...) would need converting, every future migration would need a
ledger-writer, and the whole `check-api.js` suite's assumptions would change. This is a
single-tenant app run by one operator; nothing in the actual ask needs point-in-time
replay, only "who changed what and why."

A grep confirms the underlying worry is already largely handled: zero hard `DELETE FROM
shifts/zones/workers/locations` exist anywhere in the server code today. `deleteWorker`/
`deleteOperator` are `UPDATE ... SET active = false`, not real deletes. The gap is not
"things get deleted," it's "there's no record of why an archival happened."

## Decision

An **append-only `action_log` table**, written as a **side effect** of specific
state-changing actions — not as the causal mechanism for all writes:

```
action_log(id, at, tenant_id, actor_type, actor_id, device_id NULL,
           origin ('tenant'|'superadmin'), action, target_table, target_id,
           reason NULL)
```

Callers that write to it (this decision's scope; more can be added later without a schema
change): archiving a shift (card deleted, zone reassigned, zone unassigned), archiving a
zone, superadmin-authored mutations of any kind, and every login/logout event from
decision-67. `origin` records whether a superadmin acted on a tenant's behalf — the exact
"marked as done by superuser" ask.

`shifts` gains `archived_at`, `archived_reason`, `archived_log_id` (FK to `action_log`,
nullable). `zones` already has `active` (decision-43+); reassignment/unassignment already
have their own reason shapes from decision-55 — this decision just makes them write an
`action_log` row and link it.

Admin web gains a page listing `action_log`, color-coded by action category (create /
archive / login-logout / superadmin-devops), **visible only when the signed-in admin's
row has `tenant_id = 0`** (decision-66's superadmin sentinel) — an ordinary tenant admin
never sees it, matching the "not for tenants" instruction exactly.

## Consequences

No replay, no point-in-time reconstruction — not needed, not built. Nothing enforces that
a new route remembers to write to `action_log`; a future route can simply forget.
ponytail CEILING: this is a log, not a guarantee. UPGRADE PATH: a DB trigger per audited
table, if a route ever slips through in a way that matters — deliberately not built now,
more machinery than the current problem needs. Real hard deletion (GDPR-class erasure)
still has no code path anywhere; it stays a manual devops action directly against
Postgres, same as before this decision — this decision does not build that either, only
names it as the intended escape hatch, per the owner's explicit instruction not to build
the event-sourced model or its erasure story yet.
