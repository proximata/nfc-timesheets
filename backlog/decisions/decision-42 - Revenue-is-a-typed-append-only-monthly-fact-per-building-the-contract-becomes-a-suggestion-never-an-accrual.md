---
id: decision-42
title: >-
  Revenue is a typed, append-only monthly fact per building; the contract
  becomes a suggestion, never an accrual
date: '2026-08-19 13:48'
status: accepted
---
**ACCEPTED 2026-08-19 by the owner.** Implemented by `006_zones_revenue_rates.sql` §2
(`location_revenue`). decision-28 is AMENDED, not superseded: `location_contracts` keeps its
history and its `target_minutes_per_month`.

Full design, table sketch, API surface and UI shape: `backlog/docs/ZONES-MODEL.md` §2.

**Amends decision-28** (contract history makes revenue period-correct). It does not supersede
it: `location_contracts` stays, keeps its history, keeps `target_minutes_per_month` and keeps
`client_id`-at-the-time. What changes is that the P&L stops deriving *money received* from it.
Relates to decision-6 (materials pro-rata by labour hours), decision-10 (named exclusions),
decision-16 (no framework, no ORM).

## Context

`GET /admin/pl` derives revenue by **daily accrual** (`lib/reporting.js: contractSlice`): a day
in February is worth 1/28 of the monthly fee, a day in March 1/31, summed with `numeric` and
rounded once at the end. It is careful arithmetic about a number nobody received.

The owner does not want an accrual mechanism. They want to type what the client actually paid,
per building, per month, on `/pl/`.

Two different facts had been collapsed into one:

```
CONTRACT   what was AGREED.  A rate, valid from a date until a date.   location_contracts
REVENUE    what was RECEIVED. A scalar, for one named Vienna month.    location_revenue (new)
```

The accrual also produces a standing lie the screen currently has to apologise for:
`isPartElapsed` exists because contract revenue accrues for every day in the range while
labour only exists for days that have happened — "Dieses Jahr" picked in August books five
future months of revenue and reports 71,33 % margin next to the 10,70 % the last closed month
actually made.

## Decision

**1 · A new table, and the absence of a row is the unknown.**

```sql
CREATE TABLE location_revenue (
  id            BIGSERIAL PRIMARY KEY,
  location_id   UUID NOT NULL REFERENCES locations(id),
  month         DATE NOT NULL,                    -- always the 1st, a Vienna calendar month
  amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
  note          TEXT,
  entered_by    BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at TIMESTAMPTZ,                      -- NULL = the figure in force
  superseded_by BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT location_revenue_month_start CHECK (EXTRACT(DAY FROM month) = 1)
);
CREATE UNIQUE INDEX location_revenue_one_live_idx
  ON location_revenue (location_id, month) WHERE superseded_at IS NULL;
CREATE INDEX location_revenue_month_idx ON location_revenue (month, location_id);
```

`amount_cents` is `NOT NULL` and **0 is expressible and means something**: "the client paid
nothing this month" — a credit month, a dispute, a free trial. That is a real answer, and it is
different from "nobody has told me". The difference is carried by whether a row exists, not by
a nullable column that would then have to be read correctly in four places.

`month DATE`, always the first: a month is a calendar fact with no DST to get wrong, the same
reasoning `005` used for `valid_from`/`valid_to`. `EXTRACT(DAY FROM month) = 1` rather than
`date_trunc(...)::date` only because there is no doubt about its immutability inside a `CHECK`.

*Rejected:* reusing `location_contracts` with zero-length periods — a contract is a rate with
a validity range and a payer; a payment is a scalar for a named month, and overloading one
table makes every existing contract query grow a "…but not the revenue rows" predicate.
*Rejected:* `locations.monthly_revenue_cents` — one mutable number is exactly the shape
decision-28 replaced, for exactly the reason it would break here: September's figure would
rewrite March's.

**2 · A month with no entry is UNKNOWN. Never zero, never the contract value.**

```
revenue_cents: null   revenue_unknown_reason: "not_entered"
```

On screen: „nicht eingetragen" plus an „Umsatz eintragen" action, and an answer-band cell
„Monate ohne Umsatz: N von M Objekt-Monaten". The period total is explicitly labelled
incomplete — a total over some known and some unknown revenue is not a total. Same posture
this file already takes for `no_contract`, `zero_revenue` and `insufficient_data`.
`margin_unknown_reason` gains `"revenue_not_entered"`.

**3 · The contract value becomes a SUGGESTION. It is neither a default nor dead.**

- **Not a default.** Auto-creating a revenue row from the contract *is* the rejected accrual
  wearing a different hat, and it fabricates a payment that a human then reads as confirmed.
  **Nothing writes `location_revenue` except an admin pressing save.** The migration performs
  no backfill.
- **Not dead.** `location_contracts` still carries `target_minutes_per_month` (read by
  `/analytics/`), `client_id`-at-the-time (the only way "who was paying in March" is
  answerable), and the record of what was agreed. Killing it would destroy decision-28.
- **Suggestion.** The entry field is pre-filled with the contract figure in force for that
  month, visibly labelled („Vertragswert … — als Vorschlag eingesetzt, noch nicht bestätigt")
  and stored only on submit.

And the split buys a question the P&L could not previously ask, which is the real argument for
keeping the contract alive: **vereinbart vs erhalten**, with the difference named on the row
instead of silently absorbed into the margin.

*ponytail:* the stored row does not record whether the figure was accepted from the suggestion
or typed over. CEILING: those two are indistinguishable afterwards. Pressing save is the
assertion either way, and the audit question is *who and when*, which is answered. UPGRADE
PATH: a `source TEXT CHECK (source IN ('typed','suggested'))` column.

**4 · The P&L stops pro-rating revenue, and says so when it cannot answer.**

A typed monthly payment cannot be sliced: 17/30ths of "the client paid 1.250,00 in September"
invents a payment schedule nobody agreed to.

```
period is exactly N whole Vienna months  -> revenue = SUM of those months' entries
period is ragged                         -> whole months FULLY CONTAINED only; partial months
                                            NAMED as excluded, never sliced
                                            margin_bp = NULL, "period_not_month_aligned"
```

Cost keeps its exact half-open day boundaries. Comparing a full month of revenue to a partial
month of labour is a margin computed from two different periods, so the margin is **refused
rather than approximated**. One predicate, and it is honest.

**5 · A figure is editable, and every edit is visible. Rows are APPEND-ONLY.**

```
correction   INSERT a new row for (building, month)
             + UPDATE the previous row SET superseded_at = now(), superseded_by = <admin>
retraction   UPDATE the current row SET superseded_at = now(), INSERT nothing
             -> the month reverts to UNKNOWN, which is not the same as 0
```

Hand-typed money that changes invisibly is an opinion, not a fact. This is the idiom the
schema already runs twice (`location_contracts_one_current_idx`,
`portal_grants_one_live_idx`), so it introduces no new concept.

Retraction is not optional: if a figure is entered against the wrong building, the only other
way back is "set it to 0" — which asserts that a paying client paid nothing, inside a report
that drives conversations with that client.

**6 · `/pl/` shows when a figure was last touched, in words.**

```
Umsatz  1.100,00 EUR
        eingetragen 03.09.2026 · schimmer
        geändert 11.09.2026 · schimmer · vorher 1.250,00 EUR
```

„geändert" is a word, not a colour — colour is always the second signal. The previous figure
is named, because "this was changed" without "from what" sends the director to the database.

**7 · API.**

```
GET    /admin/revenue?from&to                 the /pl/ month grid + contract suggestions
POST   /admin/locations/:id/revenue           {month:"YYYY-MM", amount_cents, note?}
DELETE /admin/locations/:id/revenue/:month    retract -> UNKNOWN
GET    /admin/pl                              revenue_cents from location_revenue
```

New validator `v.isoMonth(value, field)`: `^\d{4}-\d{2}$`, years 2000–2100, returning the
STRING `"YYYY-MM-01"` handed to Postgres as a `date` — the same reasoning as `isoDate()`,
where turning it into a JS Date re-introduces the timezone question the DATE type exists to
avoid. Future months are accepted **up to the next Vienna calendar month** and refused beyond
with `422 month_too_far_ahead`: prepaid cleaning contracts are real, and a cap of +1 month
still catches the realistic typo (the wrong year). A judgement call, named as one.

## Consequences

- **`isPartElapsed`'s worst case is designed out, for free.** An unfinished month has no
  revenue entry, so it reports *unknown* instead of *inflated*. The warning survives as a
  narrower, still-true statement about labour and materials.
- `contractSlice` keeps producing `target_minutes` for `/analytics/`; its `revenue_cents`
  output is retired from the P&L. A new `revenueSlice(from, to)` reads the in-force entries.
- **The P&L becomes month-shaped.** "Letzte 30 Tage" still works, but reports revenue only for
  whole months contained and refuses a margin. This is a visible behaviour change on a screen
  the director already uses and it must be stated on that screen, not discovered.
- **Data entry becomes a monthly ritual.** Nobody has to do it for the P&L to be *correct* —
  an unentered month is honestly unknown — but the report is only *useful* once it is done.
  The `/pl/` editor is therefore a month grid over the whole period, not a per-building modal
  reopened twelve times.
- Integer cents on the wire and in the column; the existing `parseEuroToCents` parses the
  input. No float multiply anywhere.
- 390 px (decision-28): the revenue drawer is a stacked list of month blocks, never a wide
  table; the revenue cell wraps to two lines rather than truncating its provenance.
- No new npm dependency, no new systemd unit (decision-23).
- Nothing revenue-related may ever reach the client portal (decision-43 §portal, and the
  portal's own header): a client must not read our price per square metre off our own report.

**Revisit trigger:** the first time the director asks the P&L a question that needs revenue
*earned* rather than *received* — e.g. an annual contract invoiced quarterly. That is accrual,
it is a real accounting concept, and reintroducing it is a new decision record and not a
`COALESCE`.
