---
id: decision-68
title: >-
  Debug identities 11111-99999 spawn ephemeral workers and operators behind a
  flag; Postgres TTL-sweep deletes them and their shifts after 10 minutes, no
  new service
date: '2026-08-30 04:57'
status: accepted
---
## Context

UAT and future test passes keep needing throwaway workers/operators, which either
pollute real data or require manual SQL setup/teardown each time. The owner asked for a
flag-gated shortcut: entering `11111` (and `22222` ... `99999`, so several concurrent
debug identities can be driven at once) as a login code spawns a synthetic identity that
deletes itself — and its shifts — 10 minutes later. Redis-with-TTLs was the owner's first
idea for the cleanup mechanism; rejected below in favor of what this codebase already
does.

## Decision

New feature flag `debug_identities`, off by default, gated to the full `admin` role (not
the lighter `flags` role decision-57 introduced) given this is materially more sensitive
than a cosmetic flag.

When on: entering one of the nine same-digit codes (`11111`, `22222`, ... `99999`) on
either the worker or operator code-entry door spawns (or, if one is already live for that
exact code, reuses) an ephemeral row: `is_synthetic = true`, `debug_expires_at = now() +
10 minutes`, a synthetic display name. These nine values are excluded from the real
enrolment-code generator (`server/lib/enrolment.js`) **unconditionally**, regardless of
the flag's state — a real issued 5-digit code (decision-63) can never collide with a
debug one; the cost is 9 of 100,000 values, noise.

**Cleanup: no new service.** No Redis, no cron, no scheduled job — this codebase has zero
scheduled-job infrastructure today and decision-23 locks server dependencies to `pg` +
`@sentry/node`, "and nothing else." The exact TTL-sweep idiom this codebase already
relies on three times over (expired `sessions`, expired `otp_challenges`, expired
enrolment-rate windows — all `DELETE ... WHERE expires_at < now()`, fired opportunistically
the next time anything touches that table) is reused verbatim: `DELETE ... WHERE
debug_expires_at < now()`, fired as a side effect whenever a debug-identity-touching
route runs.

This is a genuine **hard delete** — synthetic rows and their shifts are explicitly exempt
from decision-65's "archive, never delete" rule, since they never represent a real person
or a real completed shift. Every payroll/reporting query gets `is_synthetic` added to the
same `WHERE` clause it already uses for `workers.active`, so a synthetic row can never
leak into a real report even during its 10-minute life.

## Consequences

If left on in production by mistake, a confused real worker typing `11111` gets a
throwaway account instead of real access — a soft failure, not a security hole (same
ceiling already accepted for other flags). A debug row can outlive 10 minutes if nothing
happens to query the sweep path in the meantime; acceptable, since nobody outside an
active debug session is ever looking, matching the same lag already accepted for session/
OTP cleanup. Two same-digit codes are also the test vector for decision-67: signing into
the SAME code from two devices exercises the single-session kick-out; two DIFFERENT codes
signed in concurrently (including at the same zone) exercise concurrent-shift behavior.

**Why not Redis:** it is a new operated service on the one VM plus a new server
dependency, for a problem Postgres already solves with an idiom this codebase already
uses three times. No new infrastructure earns its keep here.
