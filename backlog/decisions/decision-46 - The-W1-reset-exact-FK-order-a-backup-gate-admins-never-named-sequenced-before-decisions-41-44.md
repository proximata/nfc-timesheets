---
id: decision-46
title: >-
  The W1 reset: exact FK order, a backup gate, admins never named, sequenced
  before decisions 41-44
date: '2026-08-20 07:27'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full design: `backlog/docs/OPERATOR-MODEL.md` §9-§11. Relates to decision-45 (this reset is
what W1 clears the way for), decision-41 (PROPOSED — §2 is the sequencing argument),
decision-26 (the live enrolment code §3 accounts for is one of its codes). **Supersedes
nothing.**

## Context

Owner, verbatim: *"Wipe everything: workers, locations, buildings, shifts, tags, portal
links. Keep one admin so you are not locked out of your own panel while doing it."*

Production, per `VERIFY-FINAL.md` §1.3/§4 and `check-prod-restore.mjs`, currently holds one
building, a leftover worker (`id 6, 'TTL Test', hourly_rate_cents = 0`, inactive, no
history) that migration 006's rate guard refuses on, and — per this task's brief — a live
enrolment code expiring 2026-08-22. None of that is optional context: the reset has to be
designed to run correctly with both of those facts still true.

## Decision

**1 · Scope is exactly the owner's list, plus what a foreign key forces, and nothing else.**
Named: `workers`, `locations`, `shifts`, `zones` (only if 006 has landed — pre-006 there is
no tags table), `portal_grants`. Forced by `NOT NULL` foreign keys with no cascade, not by a
separate scope decision: `worker_sessions` (cascades automatically; deleted explicitly
anyway for auditability), `material_requests` (`worker_id NOT NULL`, no orphan reading is
meaningful), `location_contracts` and `location_revenue` (`location_id NOT NULL`).
**Never named, never touched, never reachable by any cascade from the above:** `admins`,
`sessions`, `clients`, `contacts`, `inventory_items`, `app_settings`.

**2 · The reset runs BEFORE decisions 41-44 are accepted and migration 006 is applied —
recommended, not merely permitted.** `DELETE FROM workers` removes the `TTL Test` row as an
ordinary consequence of wiping every worker. By the time 006's rate guard would run against
an empty `workers` table, it passes trivially — the documented one-line ops workaround in
`server/db/README.md` becomes unneeded, not because the row was special-cased, but because
it no longer exists. Running the reset after 006 instead forfeits this for no stated
benefit.

**3 · A pre-flight guard hard-stops on a live, unredeemed enrolment code.** The reset script
queries `workers WHERE enrolment_code_hash IS NOT NULL AND enrolment_code_expires_at >
now()` before deleting anything and `RAISE EXCEPTION`s if the count is nonzero, unless an
explicit `ALLOW_LIVE_CODE_LOSS=1` is set. Silently destroying an in-progress enrolment a
real person is mid-completing is not an acceptable default; the owner chooses "wait for it
to expire/redeem" or "wipe now and re-notify" explicitly, per run.

**4 · A backup is taken and its RESTORE is verified before the reset runs, reusing the
already-deployed mechanism.** `ops/backup/pg-backup.sh` (already gated: refuses a 0-byte or
non-pg_dump artefact) followed by `ops/backup/restore-test.sh`'s exact pattern — restore
into a throwaway scratch database, assert `workers`/`locations`/`shifts` exist and carry
rows, drop the scratch DB. No new backup tooling; this is the ladder's "already-installed
dependency" rung.

**5 · Explicit, ordered `DELETE`, not `TRUNCATE ... CASCADE`**, even though both reach the
identical table set (cross-checked via `pg_constraint` where `confrelid` is `workers` or
`locations`). A reviewer reading nine explicit statements in order does not have to
reconstruct the FK graph first — the readable form is chosen deliberately for a script that
deletes a client's real data, consistent with this project's standing preference for
explicit facts over implicit derivation (decision-42).

**6 · The transaction re-checks `admins` is non-empty immediately before COMMIT and aborts
if not.** This is the concrete, load-bearing form of "keep one admin" — not a promise that
the script's DELETE list omits `admins` (true, but a copy-paste error is exactly how that
promise breaks), a runtime assertion inside the same transaction that makes a lockout
impossible to commit.

Full script sketch, NOT WRITTEN, NOT APPLIED: `OPERATOR-MODEL.md` §10.

## Consequences

**Good.**
- The owner's stated goal — "keep one admin" — is enforced by the database refusing to
  commit a state where it is false, not by a reviewer reading the script carefully.
- The `TTL Test` rate-0 blocker and the pending 006 rate guard resolve themselves as a side
  effect of correct sequencing, at zero extra engineering cost.
- Reuses `ops/backup/*.sh` unchanged — no new backup mechanism, no new restore-verification
  logic to get wrong.
- The live-enrolment-code guard converts a silent data-loss mode into a deliberate,
  logged choice (`ALLOW_LIVE_CODE_LOSS=1`).

**Costs, stated plainly.**
- Every open `material_requests` row (submitted/approved/ordered) is destroyed as a forced
  consequence of wiping workers, even though the owner's list never named material
  requests. Documented so it is not rediscovered as a surprise; not something this decision
  can avoid without leaving an orphaned, meaningless row behind instead (worse).
- The reset is NOT rehearsed against a restored dump by this decision record — that
  rehearsal, including a deliberate RED run with the `admins`-guard and the live-code guard
  disabled, is a required acceptance criterion of the implementation task, not evidence
  produced here.
- Whether to "wait" or "wipe now" for the 2026-08-22 code is NOT decided here — the guard
  only guarantees the choice is explicit, not which choice is right.

**Revisit trigger:** the owner answers §3 (wait vs. wipe-now) for the live code, or 006 is
accepted and applied before this reset runs, at which point step 2's sequencing rationale
no longer applies and the `zones`/`location_revenue` branches stop being conditional.

