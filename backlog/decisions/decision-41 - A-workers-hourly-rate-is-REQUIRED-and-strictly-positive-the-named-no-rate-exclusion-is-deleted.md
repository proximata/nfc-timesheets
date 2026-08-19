---
id: decision-41
title: >-
  A worker's hourly rate is REQUIRED and strictly positive; the named no-rate
  exclusion is deleted
date: '2026-08-19 13:48'
status: proposed
---
**PROPOSED. Not accepted. The owner accepts decisions.**

Full design, migration sketch, deletion list and failure analysis: `backlog/docs/ZONES-MODEL.md` §1.

Relates to decision-6 (materials are not attributed per building by a human), decision-10
(unresolved shifts are excluded from money and NAMED), decision-28 (contract history makes
revenue period-correct; labour stays valued at CURRENT rates until `worker_rates` exists).
**Supersedes nothing.** It removes one state from `workers`, and with it the machinery that
existed to describe that state.

## Context

`001_init.sql:25` declares `hourly_rate_cents INTEGER NOT NULL DEFAULT 0`, and
`lib/validate.js:116` reads it with `(value ?? 0)`. A worker created without a rate therefore
becomes a worker who costs €0,00 per hour, silently, at the moment of creation.

Eleven lines below that, `optionalCents()` carries the comment that names the whole defect:

> *NULL = "nobody has told me the contract volume", 0 = "this building is free of charge". A
> profitability report has to be able to stay silent about the first case rather than report
> a 100% loss, so `cents()`'s `?? 0` default would be wrong.*

Contract money got the distinction. **Wages never did.** Every rate-less defect in this system
descends from that: `/payroll/`'s `Kein Stundensatz` row state and its `Nicht bewertet`
amount; `/pl/`'s `labour_unpriced_seconds` / `_minutes` / `_workers`; the whole
`unpricedLabour()` query; the `FILTER (WHERE hourly_rate_cents <> 0)` written out in
`labourByLocation` precisely because a zero rate contributes zero and therefore looks correct
while it is quietly pricing somebody's wage; INCIDENT 5; and `rateOptionalHint`, which is
*still wrong in both locales* — it tells the director a rate-less worker appears at `0,00 €`
while payroll does the opposite (`JOURNEYS.md` D3).

Production holds **0 workers**. The client onboards next week. An empty table is the cheapest
moment there will ever be to make a column strict.

## Decision

**1 · The column refuses zero.**

```sql
ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;
ALTER TABLE workers ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);
```

`DROP DEFAULT` is the load-bearing half and is the easiest line to forget: `NOT NULL` with
`DEFAULT 0` still lands a zero on any `INSERT` that omits the column, which is the shape of
`seed.sql`, of eight fixtures in `check-api.js`, and of any import script anyone writes later.
Without the default, an omitted column raises `23502` at the point of the mistake.

`> 0`, not `>= 0`: **a rate of 0 stops being expressible.** Unlike a client contract, a wage
has no "free of charge" reading — the Austrian collective agreement for building cleaning
sets a floor well above zero, and an employee who costs nothing does not exist. It is not a
meaningful historical record either, because there is no rate history: the current value
prices all of that person's past shifts.

**2 · The API refuses it too, with a 422 that names the field.** A new
`v.requiredRate(value, field = "hourly_rate_cents")` beside `cents` / `optionalCents`:

```
absent / null / ""   422 rate_required   detail "hourly_rate_cents"
0                    422 rate_required   detail "hourly_rate_cents"
junk / negative      400 invalid_field   detail "hourly_rate_cents"   (unchanged)
```

422 and not 400 because the house line is already drawn: 400 is a malformed shape
(`invalid_field`, `invalid_uuid`), 422 is a well-formed request the business refuses
(`unknown_location`, `end_before_start`, `timestamp_out_of_range`). *"You did not tell me the
wage"* is the second kind. The one existing inconsistency — `requiredRange` uses
`400 missing_field` — is **left alone**, not copied: churning a live wire contract for
symmetry is not worth it, and the divergence is recorded here rather than rediscovered.

ONE code for both absent and zero: the director does exactly one thing about either, and two
codes would mean two message keys in two locales carrying one instruction. *ponytail:* CEILING
— the UI cannot phrase "you typed nothing" differently from "you typed zero". UPGRADE PATH:
split into `rate_required` / `rate_must_be_positive` the day someone reports the message is
confusing.

Call site: `routes/admin.js:374`, which is shared by the create and the update branch of
`upsertWorker`. **Both** must be covered — a worker created with a rate can be edited back to
empty from `/workers/`.

**3 · The migration REFUSES; it never invents.**

```sql
DO $$ DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workers WHERE hourly_rate_cents <= 0;
  IF n > 0 THEN RAISE EXCEPTION USING
    MESSAGE = format('%s worker(s) have no hourly rate; refusing to invent one.', n),
    HINT    = 'Set every rate on /workers/ first, then re-run migration 006.';
  END IF;
END $$;
```

`migrate.js` runs each file with `psql -1`, so the raise aborts that file, records nothing and
leaves the database exactly as it was; re-running after the rates are set applies it. A
migration that halts with a count and an instruction is strictly better than one that writes
a number nobody chose into a payroll column, and better than one that deactivates people to
avoid the question.

*Rejected:* exempting inactive workers (`CHECK (hourly_rate_cents > 0 OR NOT active)`). There
are no such rows, so it would ship a hole with no occupant, and the hole is reachable —
deactivate, set 0, and the row can no longer be reactivated without an edit nobody expects.
CEILING: a restored dump containing a leaver whose rate was never recorded blocks the
migration until a human names a figure. UPGRADE PATH if that becomes real: a dated
`rate_unknown_reason TEXT`, which is a *stated* gap, never a 0.

**4 · The named exclusion is DELETED, because the state it describes cannot occur.** The
brief's escape hatch — *"if a 0 rate stays expressible, keep the exclusion for that case"* —
does not fire: `CHECK (hourly_rate_cents > 0)` makes 0 unrepresentable in the only table that
has it, on all three write paths (§Consequences). Full deletion list in `ZONES-MODEL.md` §1.5.

**5 · CORRECTION to the instruction: the CSV `Hinweis` column STAYS.** `payroll/page.tsx`
builds that column from `ev(line)`, which concatenates three exclusions:

```
excludedUnresolved  "# zu bestätigen"    decision-10   STAYS
excludedOpen        "# noch offen"       decision-10   STAYS
excludedNoRate      "Kein Stundensatz"   decision-41   DELETED
```

Deleting the column would delete decision-10's exclusion reporting from the artefact the
director takes to the bank. What is deleted is the **no-rate contribution** to it, plus
`csvTotalNoRate` on the total row, plus the blanking of the CSV rate and amount cells — every
row now carries both.

## Consequences

**The invariant cannot recur, and each path has a RED case that must be shown failing.**

| # | Path | Gate | Seed → expect RED |
| --- | --- | --- | --- |
| 1 | API `POST /admin/workers`, create **and** update | `v.requiredRate` | no rate → `422 rate_required`; `0` → `422`. Revert the validator → both 201 |
| 2 | direct SQL | `CHECK (> 0)` + no default | `INSERT INTO workers (name) VALUES ('x')` → `23502`; `… VALUES ('x', 0)` → `23514`. Drop the constraint → both land a 0 |
| 3 | seed / import | `seed.sql` ✓ (1450/1380/1520), `check-migrate.js:359` ✓ (1500), `check-api.js:2966` inserts 0 deliberately | that fixture becomes an assertion that the insert is REFUSED |

- **`labour_seconds` and `labour_cents` now describe the same set of seconds.** Any divergence
  is a bug, not a state. Pin it: assert `labour_cents > 0` whenever `labour_seconds > 0`.
- **`labour.rate_basis: "current"` and `rate_basis_note` STAY.** They state a *different*,
  still-true limitation. Deleting them along with the `unpriced_*` fields is the likeliest
  mistake in this work: it would make the P&L look more certain than it is.
- **This does not fix rate history.** `workers.hourly_rate_cents` is still one mutable column,
  so raising a wage still re-values last March. decision-28 fixed period-correct *revenue*;
  period-correct *labour* is `worker_rates` and its own decision record. This narrows the hole
  (a wage is now always *some* number) without closing it.
- The check at `check-api.js:2956` — *"labour nobody has priced is excluded from cost AND
  named, never valued at zero"* — is **replaced** by the negative case of the new invariant,
  not merely removed.
- de/en exact key parity is enforced by `web/scripts/check.mjs`. ~14 keys are deleted in both
  files and three are added (`workers.rateRequired`, `error.rateRequired`, a reworded
  `workers.rateHint`).
- No new npm dependency. Server deps stay `pg` + `@sentry/node` (decision-23).

**Revisit trigger:** the first time somebody legitimately needs to record an unpaid worker —
a trainee on a state-funded scheme, a working owner. The answer is a *reason column*, not a
zero, and it is a new decision record.
