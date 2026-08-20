---
id: decision-45
title: >-
  Operator identity is phone-based, lives outside workers, collision made
  impossible by a shared registry
date: '2026-08-20 07:26'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full design: `backlog/docs/OPERATOR-MODEL.md` §2-§7. Relates to decision-20 (admin
email+password, untouched by this record — §5), decision-22 (worker identity from the
session, never the body — the same rule now covers `operator_sessions`), decision-26
(enrolment codes — reused verbatim, not reimplemented, §6/§7), decision-41 (PROPOSED, and
in direct, unresolved tension with this record — see the Conflict section below and
`OPERATOR-MODEL.md` §8). **Supersedes nothing.**

## Context

The owner, verbatim (`ops/workflows/ITERATIONS.md`):

> An OPERATOR is identified by PHONE NUMBER. Multiple operator phones allowed. Operator
> phones and worker phones live in ONE namespace and may never collide, so the uniqueness
> has to be enforced by the database, not by a screen. An operator is NOT a cleaner: no
> clock-in, no clock-out. He reads and writes tags. Create a worker from the phone by
> typing name + phone.

Today `admins` (username+password, one row) and `workers` (optional free-text `phone`,
never validated, never unique) are unrelated tables. Nothing enforces phone uniqueness
across them, and nothing needed to — no requirement asked for it until now.

## Decision

**1 · Two tables, not one with a role.** `workers` is UNCHANGED — no column added, no
constraint touched. A new `operators` table holds operator-only facts (name, active, an
audit `created_by`, and decision-26's five `enrolment_code_*` columns, copied verbatim).
Rejected: merging into `workers` with an `is_operator` flag. Reason: decision-41 is
PROPOSED and, as worded, puts an unconditional `CHECK (hourly_rate_cents > 0)` on every row
in `workers` with no exemption for any state. A pure operator has no cleaning wage to
satisfy that with. Keeping `operators` separate makes that collision structurally
impossible regardless of how decision-41 is ultimately ruled on, instead of coupling two
independent decisions that do not need to be coupled.

**2 · The uniqueness lives in one new table, `phone_identities`, not in two UNIQUE columns
and an app-level check.** `phone_identities (phone_e164 PRIMARY KEY, worker_id UNIQUE NULL,
operator_id UNIQUE NULL, CHECK (worker_id IS NOT NULL OR operator_id IS NOT NULL))`. A
read-then-write app-level check across two tables is a race, not an impossibility, and the
brief is explicit that the collision must be impossible. The PK on `phone_e164` is what
makes the second conflicting INSERT fail atomically, in the same transaction, before either
row commits — the same idiom `zones_tag_serial_idx` (decision-44) and
`shifts_one_open_per_worker_idx` (001) already use.

**3 · One person may hold both roles — one phone, one registry row, up to two person-rows.**
"An operator does not clock in" is enforced structurally (no `auth: "operator"` route is
ever reachable near `/shifts/open`), not by refusing a human two identities. When the owner
cleans a building himself, `phone_identities` for his number carries BOTH `worker_id` AND
`operator_id`, set explicitly by an admin action (not automatic, not built in W1). The
registry's per-column UNIQUE constraints still forbid that phone from ever backing a
SECOND, different worker or operator — the ambiguity the owner described stays impossible;
only the intentional, single-person, both-roles case is representable.

**4 · A phone is normalised to E.164 at the point it becomes an identity, and is REJECTED,
not guessed, when the country cannot be told from what was typed.** A leading `0` is read as
Austrian and gets `+43`; a leading `+` or `00` is taken as given; anything else — a bare
national number with neither — is refused with `422 invalid_phone` rather than assumed to be
Austrian. `workers.phone` (free text, decorative, optionally present since migration 003)
is explicitly NOT touched or retroactively normalised by this decision; it keeps its
documented meaning (`lib/validate.js`: "never normalised, because normalising means
silently changing what the director typed"). Only phone numbers entered through the NEW,
validated paths (an operator's own enrolment, or `POST /operator/workers`) become
`phone_identities` rows.

**5 · The web admin's login is untouched, now and through W5.** `admins` gains no phone
column, `phone_identities` gains no `admin_id` column. Replacing the admin's
username+password with phone identity would break the one login that must never break,
for a verification mechanism (SMS, W5) that does not exist yet. If the owner later wants
the web admin reachable by phone too, that is a new, explicit decision.

**6 · The operator's own login, for W1, reuses decision-26's enrolment codes verbatim —
not raw phone entry, not a new credential type.** `operator_sessions` mirrors
`worker_sessions` byte-for-byte (hashed bearer token, `ON DELETE CASCADE`, the same
opportunistic expiry sweep). `POST /auth/operator-code` mirrors `POST /auth/code`
exactly, including its rate limiting. SMS (W5) replaces this and the worker Android
enrolment-code path together, in one later change — not before.

## Conflict this decision does NOT resolve

"Create a worker from the phone by typing name + phone" (this record, and the owner's own
words) and "a worker's hourly rate is REQUIRED and > 0, no exemption" (decision-41,
PROPOSED, and explicit that no exemption — including an inactive-row exemption — is
acceptable) are in direct tension on the one field that matters: `POST /operator/workers`
supplies no rate, by specification. Today (rate `DEFAULT 0`, accepted schema) the endpoint
works and manufactures a known defect class (an invisible €0/h worker) on purpose, once per
field-created worker. The day decision-41 is accepted as worded, the same endpoint starts
failing on every call. Full accounting: `OPERATOR-MODEL.md` §8. **Not decided here.** The
owner must either amend decision-41 with an explicit carve-out for operator-created rows,
or accept that "name + phone" grows a required third field the day 41 lands.

## Consequences

**Good.**
- The collision the owner described is enforced by a `PRIMARY KEY`, not by a screen or an
  app-level check — provably impossible, including under concurrent writers.
- `workers` and `admins` are byte-identical to today; decision-41's eventual ruling cannot
  retroactively affect an operator's existence.
- No new npm dependency. No new session-cookie mechanism — `operator_sessions` and
  `POST /auth/operator-code` are copies of an already-deployed, already-audited pattern.
- Forward-compatible with W5 (SMS) without a second migration: `phone_identities` already
  holds the canonical number W5 needs to text.

**Costs, stated plainly.**
- A worker can, after this ships, carry two different-looking phone numbers on file (legacy
  free-text `workers.phone`, and — only if promoted — a canonical `phone_e164` via the
  registry). They are not asserted to agree. Promotion of existing rows is a named, future,
  one-click admin action, not built here.
- §8's conflict is real and unresolved. Nothing that depends on its resolution should be
  built past the shape in `OPERATOR-MODEL.md` §7 until the owner rules.
- The phone normaliser is Austria-default and hand-rolled (no `libphonenumber-js` — the
  first non-`pg`/`@sentry` dependency this would be). A non-Austrian operator phone typed
  without a `+` is rejected, not misparsed — safe, but a real UX ceiling if a non-Austrian
  operator is a near-term requirement.
- `phone_identities` rows can decay to `worker_id IS NULL AND operator_id IS NULL` after an
  `ON DELETE SET NULL` on one side while the other still references it from a row that
  itself is about to be deleted in the same transaction — not reachable as a resting state
  in practice (both deletes are typically the same transaction), but routine cleanup
  (`DELETE FROM phone_identities WHERE worker_id IS NULL AND operator_id IS NULL`) is named
  as an operational task, not automated by a trigger.

**Revisit trigger:** the owner rules on §8's conflict (blocks `POST /operator/workers` from
being built as specified), or a non-Austrian operator phone becomes a real requirement
(promotes `libphonenumber-js` from a named upgrade path to a decision of its own).

