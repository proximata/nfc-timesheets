# ZONES-MODEL — four owner-mandated changes, designed against the code

Status: **design. Nothing built, nothing applied, no migration file created.** The SQL in §6 is
a sketch inside this document. Production was not touched.

Supersedes `backlog/docs/ZONES-DESIGN.md` where they disagree. That document was written
before the owner had settled four things; the disagreements are itemised in §0.3 so nobody
has to diff two long files.

Input actually read, not assumed: `server/lib/validate.js`, `server/lib/reporting.js`,
`server/routes/admin.js`, `server/routes/app.js`, `server/routes/portal.js`,
`server/db/migrations/001`–`005`, `server/db/seed.sql`, `server/check-api.js`,
`web/app/payroll/page.tsx`, `web/app/pl/page.tsx`, `web/app/workers/page.tsx`,
`web/app/locations/page.tsx`, `web/messages/de.json`,
`android/…/core/TagLink.kt`, `android/…/nfc/KnownTags.kt`, `android/…/nfc/ScanActivity.kt`,
`android/…/data/ShiftStore.kt`, `android/…/data/ShiftSync.kt`,
`backlog/docs/JOURNEYS.md`, `backlog/docs/IA-PLAN.md` §8–§9, `backlog/decisions/*`.

Four decision records accompany it, all **PROPOSED**:

```
decision-41  a worker's hourly rate is REQUIRED; the no-rate exclusion is deleted
decision-42  revenue is a TYPED, APPEND-ONLY monthly fact; the contract becomes a suggestion
decision-43  zones carry m2, the building's area is derived, an unzoned building is grey
             --> SUPERSEDES decision-37
decision-44  a tag serial is DATA on a zone, reaching the phone through /roster; no new route
```

---

## 0 · One screen

### 0.1 The four changes

```
1  WORKER RATE   NOT NULL + CHECK (> 0) + DROP DEFAULT.  0 stops being expressible.
                 -> the named no-rate exclusion is DELETED from /payroll/, /pl/, /workers/
                 -> the CSV "Hinweis" COLUMN STAYS (it also carries decision-10) -- see 1.5

2  REVENUE       location_revenue: one APPEND-ONLY row per (building, Vienna month).
                 no entry = UNKNOWN, never 0.  contract becomes a SUGGESTION, stays alive
                 for target_minutes + "agreed vs received".  P&L revenue stops accruing.

3  ZONES         zones child of locations, area_sqm NULLable, building area = SUM (derived).
                 contract stays on the BUILDING.  shift stays BUILDING-level; two nullable
                 tap-fact columns.  A BUILDING UUID RESOLVES TO THE BUILDING, FOR EVER.
                 unzoned = a PRESENTATION state (grey), NEVER locations.active.

4  SERIALS       zones.tag_serial, shipped to the phone inside /roster.  NO new endpoint.
                 KnownTags.kt deleted only AFTER a HOIV zone carries the serial.
```

### 0.2 The three things that must not break, in order of cost

```
1  the card on the wall            https://timesheets.exe.xyz/t?l=c3c37d4a-...  (a BUILDING uuid)
   -> it has 0 zones today.  If "no zones" ever means "refuses to resolve", this design
      undoes the host resurrection that was just shipped.  See 3.4.  THIS IS THE LANDMINE.
2  the mounted EV1 serial 04:A1:A8:52:AE:5C:80  -> stranded the moment KnownTags is deleted
      without a zone row carrying it.  See 4.4.
3  the one field phone's worker session  -> untouched by all four changes (server-side only
      plus one additive roster field).  No re-enrolment.
```

### 0.3 Where this departs from ZONES-DESIGN.md / decision-37

| decision-37 said | now | why |
| --- | --- | --- |
| `square_metres` **rejected** — "a per-zone area invites a per-zone cost" | `area_sqm` on every zone, NULLable | The owner wants €/m² at the BUILDING. The invitation is real and is refused explicitly in §3.6 instead of by leaving the column out. |
| building area: not a concept | derived `SUM(zones.area_sqm)`, never stored | 005's rule: derivable facts are not stored. |
| creating a building walks to a tag URI | building creation does NOT walk through tag writing; adding a **zone** does | Owner. §3.5. |
| a building with no zones is just a building | it is **unzoned**, drawn grey on the map, with a named next action | Owner. It is presentation only. §3.4. |
| "no way to force an APK update" ⇒ deployment landmine #1 | one phone, `adb install -r`, sideloaded | Changed since decision-37 was written (decision-40 run). The landmine shrinks to one install. |
| `KnownTags.BY_SERIAL` stays as a compiled fallback | **deleted**, on a stated sequence | Owner. §4.4 states exactly what strands the tag. |
| serial adoption "one column, lands with this migration" | unchanged ✓ | — |
| shift stays BUILDING-level, two nullable zone columns | unchanged ✓ | Re-derived and re-defended in §3.2. |
| the tag URI is `/t?l=<uuid>`, id space shared | unchanged ✓ | The card on the wall depends on it. |

---

# 1 · WORKER RATE BECOMES REQUIRED

## 1.1 The defect, exactly

```
001_init.sql:25   hourly_rate_cents INTEGER NOT NULL DEFAULT 0
validate.js:116   const n = ... : (value ?? 0)           <- absent becomes 0, silently
admin.js:374      const rate = v.cents(body.hourly_rate_cents)
workers/page.tsx  rate field is marked `optional`; '' -> 0 on submit
```

`optionalCents()` sits eleven lines below `cents()` with the comment that names the whole
bug: *"NULL = nobody has told me the contract volume, 0 = this building is free of charge …
`cents()`'s ?? 0 default would be wrong."* Contract money got the distinction. Wages did not.
Every rate-less defect in this system descends from that one line: `/payroll/`'s
`Kein Stundensatz` row, `/pl/`'s `labour_unpriced_*`, `unpricedLabour()`, INCIDENT 5, and
`rateOptionalHint` — which is *still wrong in both locales*, telling the director a rate-less
worker appears at `0,00 €` when payroll does the opposite (JOURNEYS D3).

Owner decision: **a rate is REQUIRED.**

## 1.2 The column

```sql
ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;
ALTER TABLE workers ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);
```

`DROP DEFAULT` is the load-bearing half and is easy to forget. `NOT NULL` alone with
`DEFAULT 0` still silently lands a 0 on any `INSERT` that omits the column — which is
precisely the shape of `seed.sql`, of eight inserts in `check-api.js` and of any future
import script. With the default gone, an omitted column raises `23502 not_null_violation`
at the point of the mistake.

`> 0` and not `>= 0`: **0 stops being expressible.** A wage of zero is not a state this
business has. The Austrian collective agreement for building cleaning sets a floor well
above zero; an employee who costs nothing does not exist, and unlike a client contract there
is no "free of charge" reading to preserve. The rate is also read for shift history at its
CURRENT value (there is no rate history — see 1.7), so a 0 is not even a historically
meaningful record of a past arrangement.

**∴ the exclusion machinery is deleted, not retained.** The brief's condition — *"if a 0 rate
stays expressible, keep the exclusion for that case and say so"* — does not fire, because
`CHECK (hourly_rate_cents > 0)` makes 0 unrepresentable in the only table that has it.

## 1.3 Existing rows: the migration REFUSES rather than invents

Production: **0 workers.** Nothing to fix, which is why this is the moment.

The migration must still be correct on a database that is not empty (a dev box, a restored
dump, the demo DB). It does not invent a wage and it does not deactivate anybody:

```sql
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workers WHERE hourly_rate_cents <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('%s worker(s) have no hourly rate.', n),
      HINT    = 'Set every rate on /workers/ first, then re-run. This migration will not '
                'invent a wage and will not deactivate anybody.';
  END IF;
END $$;
```

`migrate.js` runs each file with `psql -1`, so the raise aborts this file, records nothing
and leaves the database exactly as it was. Re-running after the rates are set applies it.
A migration that halts loudly with a count and an instruction is strictly better than one
that writes a number nobody chose into a payroll column.

**Rejected: exempt inactive workers** (`CHECK (hourly_rate_cents > 0 OR NOT active)`). There
are no such rows, so the exemption would ship a hole with no occupant, and the hole is
reachable: deactivate → set 0 → the row is now un-reactivatable without an edit nobody
expects. `ponytail:` no exemption. CEILING: if a leaver whose rate was never recorded ever
turns up in a restored dump, the migration blocks until a human names a figure. UPGRADE
PATH if that becomes real: a dated `rate_unknown_reason TEXT` column, which is a *stated*
gap, never a 0.

## 1.4 The 422, naming the field

New validator, beside `cents` / `optionalCents`:

```js
/**
 * A worker's hourly rate. REQUIRED and STRICTLY POSITIVE (decision-41).
 * `cents()`'s `?? 0` default is exactly what let a missing wage become a confident zero;
 * this function has no default and no zero.
 */
export function requiredRate(value, field = "hourly_rate_cents") {
  if (value === undefined || value === null || value === "") fail(422, "rate_required", field);
  const n = cents(value, field);          // shape only: 400 invalid_field on junk/negative
  if (n === 0) fail(422, "rate_required", field);
  return n;
}
```

```
absent / null / ""      422 rate_required   detail: "hourly_rate_cents"
0                       422 rate_required   detail: "hourly_rate_cents"
"abc" / -5 / 1e12       400 invalid_field   detail: "hourly_rate_cents"   (unchanged)
```

**Why 422 and not 400.** The house line is already drawn: 400 = the shape is wrong
(`invalid_field`, `invalid_uuid`), 422 = the shape is fine and the business refuses it
(`unknown_location`, `end_before_start`, `timestamp_out_of_range`). "You did not tell me the
wage" is a well-formed request the business refuses. Note the one existing inconsistency:
`requiredRange` uses `400 missing_field`. It is not changed here — a wire contract for
`?from=` is not worth churning for symmetry, and the divergence is recorded rather than
quietly copied.

**One code, not two.** Absent and zero both mean "name the wage", the director does exactly
one thing about either, and two codes would mean two message keys × two locales carrying one
instruction. `ponytail:` CEILING — the client cannot say "you typed zero" differently from
"you typed nothing". UPGRADE PATH: split into `rate_required` / `rate_must_be_positive` the
day someone reports the message is confusing.

Call sites: `admin.js:374` `v.cents(body.hourly_rate_cents)` → `v.requiredRate(...)`, on
**both** the create and the update branch (it is one variable, so one edit — verify it is
used by both `INSERT` and `UPDATE`; it is).

## 1.5 What gets DELETED — the full list, and one correction to the brief

### CORRECTION, stated first because it is a change to the instruction

> *"the CSV Hinweis column and their messages"*

**The `Hinweis` column stays.** `web/app/payroll/page.tsx` builds it from `ev(line)`, which
concatenates **three** exclusions:

```
excludedUnresolved   "# zu bestätigen"   <- decision-10, STAYS
excludedOpen         "# noch offen"      <- decision-10, STAYS
excludedNoRate       "Kein Stundensatz"  <- DELETED by decision-41
```

Deleting the column would delete the decision-10 exclusion reporting from the payroll export,
which is the artefact the director takes to the bank. What is deleted is the **no-rate
contribution to it** and the total-row note. Everything else in that column is a different
invariant that this change does not touch.

### server/

| File | Delete |
| --- | --- |
| `lib/reporting.js` `labourByLocation` | `FILTER (WHERE hourly_rate_cents <> 0)` on the cost SUM; the `unpriced_seconds` and `unpriced_workers` select-list entries |
| `lib/reporting.js` | the entire `unpricedLabour()` function and its `Promise.all` slot in `profitAndLoss` |
| `lib/reporting.js` `profitAndLoss` per building | `labour_unpriced_seconds`, `labour_unpriced_minutes`, `labour_unpriced_workers` |
| `lib/reporting.js` `profitAndLoss` top level | `labour.unpriced_seconds`, `labour.unpriced_minutes`, `labour.unpriced_workers` |
| `lib/reporting.js` header comment | the bullet `* a worker with no hourly rate -> excluded from labour cost AND counted` |

`labour.rate_basis: "current"` and `rate_basis_note` **STAY**. They state a *different*, still
true limitation (§1.7). Deleting them with the rest is the likeliest mistake in this task.

### web/

| File | Delete |
| --- | --- |
| `app/payroll/page.tsx` | the `noRate` const at ~262, ~318, ~352, ~770; the `eo` / rate-less line list; `answerExcludedNoRate`; `answerHoursUnvalued`; the `caveatNoRate` bullet + `caveatNoRateLink`; `rowNoRate`; `amountNoRate`; `excludedNoRate` inside `ev()`; `csvTotalNoRate`; the `l ? '' : String(...)` blanking on the CSV rate/amount cells (every row now carries both) |
| `app/workers/page.tsx` | `noRate`; `rateOptionalHint`; `optional` on the rate `Field` (→ `required`); `rate: worker.hourly_rate_cents === 0 ? '' : …` (always formatted); `'' → 0` on submit (→ a client-side required error); the panel's `0 === … ? noRate : …` branch |
| `app/pl/page.tsx` | the unpriced-labour flagged block, its method bullet, and every read of `labour_unpriced_*` |
| `lib/api.ts` | the `labour_unpriced_*` and `labour.unpriced_*` fields on the P&L types |

### web/messages/ — de.json AND en.json, exact key parity

```
payroll.answerExcludedNoRate   payroll.caveatNoRate       payroll.caveatNoRateLink
payroll.excludedNoRate         payroll.rowNoRate          payroll.amountNoRate
payroll.csvTotalNoRate         payroll.answerHoursUnvalued
workers.noRate                 workers.rateOptionalHint
pl.<the unpriced-labour keys>  (enumerate at implementation time; grep `unpriced`/`NoRate`)
```

`web/scripts/check.mjs` is the parity gate. New keys needed: `workers.rateRequired`,
`error.rateRequired`, and `workers.rateHint` reworded to Austrian business German
("Pflichtfeld. Brutto-Stundensatz laut Kollektivvertrag, z. B. 14,50").

### check-api.js

The test at ~2956, *"labour nobody has priced is excluded from cost AND named, never valued
at zero"*, is **replaced**, not removed. Its replacement is the negative case of the new
invariant (§1.6).

## 1.6 The invariant cannot recur — three paths, each with a RED case

**A check whose negative case cannot fail is not a check.** Each of these must be shown
failing before the fix, in the run that lands it.

| # | Path | Gate | Seed the condition → expect RED |
| --- | --- | --- | --- |
| 1 | **API** `POST /admin/workers` | `v.requiredRate` | `{name:"X"}` with no rate → `422 rate_required`; `{hourly_rate_cents:0}` → `422`. Revert the validator → both 201. |
| 2 | **Direct SQL** | `CHECK (hourly_rate_cents > 0)` + no default | `INSERT INTO workers (name) VALUES ('x')` → `23502`; `INSERT … VALUES ('x', 0)` → `23514`. Drop the constraint → both succeed and land a 0. |
| 3 | **Seed / import** | `seed.sql`, `check-migrate.js`, `check-api.js` fixtures | Re-read all three. `seed.sql` already sets 1450/1380/1520 ✓; `check-migrate.js:359` sets 1500 ✓; `check-api.js:2966` deliberately inserts 0 and must now assert the refusal. |

There is a fourth path the brief did not name and it is the one most likely to be missed:
**the UPDATE branch of `upsertWorker`**. A worker created with a rate can be edited back to
empty from `/workers/`. Same validator, same test.

`ops/issue-invite.mjs` does not create workers (verify at implementation; if it ever does, it
is path 5).

**After this, `labour_seconds` and `labour_cents` describe the same set of seconds.** Any
divergence between them is a bug, not a state — which is exactly what makes the exclusion
deletable. Pin it: a check asserting `labour_cents > 0` whenever `labour_seconds > 0`.

## 1.7 What this does NOT fix

**There is still no rate history.** `workers.hourly_rate_cents` is one mutable column, so
raising a wage still silently re-values last March. `labour.rate_basis: "current"` stays on
the wire and the notice stays on the screen. decision-28 fixed period-correct *revenue*;
period-correct *labour* is `worker_rates` and is a separate decision record. Making the rate
required narrows the hole (a wage is now always *some* number) without closing it.

Effort: **medium.** One migration, one validator, ~6 files, ~14 message keys × 2 locales.
Most of it is deletion, which is why it is not high.

---

# 2 · REVENUE IS A TYPED FACT

## 2.1 What is there today, and why it is not what the owner wants

`GET /admin/pl` derives revenue from `location_contracts` by **daily accrual**
(`contractSlice`): a day in February is worth 1/28 of the monthly fee, a day in March 1/31,
summed and rounded once. It is careful arithmetic about a number nobody received.

The owner does not want an accrual mechanism. They want to type what the client actually
paid, per building, per month.

Those are different facts:

```
CONTRACT   what was AGREED, from a date, until a date.  A rate.       location_contracts
REVENUE    what was RECEIVED, for one Vienna month.     A payment.    location_revenue  (new)
```

## 2.2 The table

```sql
CREATE TABLE location_revenue (
  id             BIGSERIAL PRIMARY KEY,
  location_id    UUID NOT NULL REFERENCES locations(id),
  month          DATE NOT NULL,                     -- always the 1st, Vienna calendar month
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  note           TEXT,
  entered_by     BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,                       -- NULL = this is the figure in force
  superseded_by  BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT location_revenue_month_start CHECK (EXTRACT(DAY FROM month) = 1)
);

-- ONE figure in force per building per month. Partial, so corrections pile up as history —
-- the same shape as location_contracts_one_current_idx and portal_grants_one_live_idx.
CREATE UNIQUE INDEX location_revenue_one_live_idx
  ON location_revenue (location_id, month) WHERE superseded_at IS NULL;

-- "revenue for these months, all buildings" — the only way the P&L reads this table.
CREATE INDEX location_revenue_month_idx ON location_revenue (month, location_id);
```

Four things to notice:

- **`amount_cents` is NOT NULL, and the ROW's absence is the unknown.** 0 is expressible and
  means "the client paid nothing this month" — a credit month, a dispute, a free trial. That
  is a real, different answer from "nobody has told me", and the difference is carried by
  whether a row exists, not by a nullable column that would have to be read correctly in
  four places.
- **`month DATE`, always the 1st.** A month is a calendar fact with no DST to get wrong —
  the same reasoning `005` used for `valid_from`/`valid_to`. `EXTRACT(DAY FROM month) = 1` is
  the immutability-safe form of "the first of the month"; it is preferred over
  `date_trunc(...)::date` only because there is no doubt about it in a `CHECK`.
- **APPEND-ONLY.** Rows are never `UPDATE`d. A correction inserts a new row and stamps
  `superseded_at` on the old one. This is §2.6.
- **`entered_by` / `entered_at`.** Who typed it and when. This is the audit answer, and it is
  the reason `admins` is referenced at all.

**Rejected: reuse `location_contracts` with a zero-length period.** A contract is a rate with
a validity range and a `client_id`-at-the-time; a payment is a scalar for a named month.
Overloading one table means every existing contract query grows a "…but not the revenue
rows" predicate, and the P&L would still have to decide whether to accrue.

**Rejected: `locations.monthly_revenue_cents`.** One mutable number per building is the exact
shape decision-28 already replaced for contracts, for the exact reason it would break here:
September's figure would rewrite March.

## 2.3 A month with no entry

**Unknown. Never zero. Never the contract value.**

```
revenue_cents:          null
revenue_unknown_reason: "not_entered"        (today's value is "no_contract")
```

On `/pl/`, per building row:

```
Umsatz    nicht eingetragen          [ Umsatz eintragen ]
```

and the answer band gains a fourth cell that is impossible to skip:

```
Monate ohne Umsatz        3
                          von 12 Objekt-Monaten im Zeitraum
```

The period total is then explicitly labelled incomplete — a P&L total computed over some
known and some unknown revenue is not a total, and the screen says so in words. This is the
same posture the file already takes for `no_contract`, `zero_revenue` and
`insufficient_data`, and the same rule as §1: a named, counted gap, never a confident zero.

`margin_unknown_reason` gains `"revenue_not_entered"`.

## 2.4 What becomes of the contract value: **SUGGESTION**, and it earns a new answer

Not a default. Not dead.

- **Not a default.** Auto-creating a revenue row from the contract IS the accrual the owner
  rejected, wearing a different hat, and it would fabricate a payment that a human then sees
  as confirmed. Nothing writes `location_revenue` except an admin pressing save.
- **Not dead.** `location_contracts` still carries `target_minutes_per_month` (which
  `/analytics/` reads), `client_id`-at-the-time (which is how "who was paying in March" is
  answered at all), and the record of what was agreed. Killing it would destroy decision-28.
- **Suggestion.** The revenue entry field is **pre-filled** with the contract figure in force
  on that month, labelled as a suggestion, and stores nothing until submitted:

```
Umsatz September 2026 · HOIV Arsenalstraße 11
[ 1.250,00 ]  EUR
Vertragswert für diesen Monat: 1.250,00 EUR — als Vorschlag eingesetzt, noch nicht bestätigt.
```

And the change buys a question the P&L could not previously ask, which is the real argument
for keeping the contract alive:

```
vereinbart   1.250,00     <- location_contracts, the month's contract value
erhalten     1.100,00     <- location_revenue
Differenz     -150,00     named on the row, not silently absorbed into the margin
```

`ponytail:` the stored row does **not** record whether the figure came from the suggestion or
was typed over. CEILING: an accepted suggestion is indistinguishable from a hand-typed
identical figure. That is fine — pressing save is the assertion either way, and the audit
question is *who and when*, which is answered. UPGRADE PATH: a `source TEXT CHECK (source IN
('typed','suggested'))` column.

## 2.5 The P&L stops accruing — and the consequence must be stated, not hidden

A typed monthly payment **cannot be pro-rated**. Slicing "the client paid 1.250,00 in
September" into 17/30ths for a period ending on the 17th invents a payment schedule nobody
agreed to.

```
period is exactly N whole Vienna months   -> revenue = SUM of those months' entries
period is ragged (e.g. "letzte 30 Tage")  -> revenue = whole months FULLY CONTAINED only
                                             partial months NAMED as excluded, never sliced
                                             margin_bp = NULL, reason "period_not_month_aligned"
```

Cost keeps its exact half-open day boundaries. Comparing a full month of revenue to a
partial month of labour would be a margin computed from two different periods, so the margin
is refused rather than approximated. One predicate, and it is honest.

**This deletes an existing lie for free.** `isPartElapsed` exists because contract revenue
accrues for every day in the range while labour only exists for days that have happened —
"Dieses Jahr" picked in August books five future months of revenue and reports 71,33 %
against the 10,70 % the last closed month actually made. With typed revenue, a month that
has not finished simply has no entry, so it reports **unknown** instead of inflated. The
`isPartElapsed` warning survives as a narrower, still-true statement about labour and
materials; the revenue half of it is designed out.

Server changes: `contractSlice` keeps `target_minutes` and its `revenue_cents` output is
retired from the P&L (the analytics path still uses the target). A new `revenueSlice(from,to)`
returns the in-force entries per building for the whole months contained.

## 2.6 Editable later? YES — and every edit is visible

A payment gets corrected: a credit note, a rebate, a figure read off the wrong line of a bank
statement. Refusing edits pushes the correction into a note nobody reads.

**Edits are append-only.** `UPDATE` is never issued against a live figure:

```
correction  INSERT a new row for (building, month)
            + UPDATE the previous row SET superseded_at = now(), superseded_by = <admin>
retraction  UPDATE the current row SET superseded_at = now()   and insert NOTHING
            -> the month goes back to UNKNOWN, which is not the same as 0
```

That is the same idiom the schema already runs twice (`location_contracts_one_current_idx`,
`portal_grants_one_live_idx`), so it is not a new concept for anyone reading this database.

**Retraction is not optional.** If the admin types 1.250,00 against the wrong building, the
only alternative retraction is "set it to 0" — and 0 means *they paid nothing*, which would be
a false statement about a paying client sitting in a P&L that drives client conversations.

## 2.7 Does /pl/ show when a figure was last touched? YES

Hand-typed money that changes invisibly is an opinion. On the building row:

```
Umsatz  1.100,00 EUR
        eingetragen 03.09.2026 · schimmer
```

and where `superseded_at IS NOT NULL` exists for that (building, month):

```
        geändert 11.09.2026 · schimmer · vorher 1.250,00 EUR
```

"geändert" is a **word**, not a colour — colour is always the second signal. The previous
figure is named, because "this was changed" without "from what" sends the director to the
database.

## 2.8 API surface

```
GET    /admin/revenue?from=&to=
       -> { months: ["2026-07","2026-08","2026-09"],
            entries: [ { location_id, month, amount_cents, note,
                         entered_by_name, entered_at, changed_at, previous_amount_cents } ],
            contract_suggestions: [ { location_id, month, amount_cents } ] }
       The grid the /pl/ editor renders. Months come from the SERVER's Vienna calendar,
       never from the browser's.

POST   /admin/locations/:id/revenue   { month: "YYYY-MM", amount_cents, note? }
       201 created / 200 superseded-and-replaced
       422 rate ... no: 422 month_too_far_ahead | 422 unknown_location | 400 invalid_month

DELETE /admin/locations/:id/revenue/:month
       200 -> the month reverts to UNKNOWN. Never deletes a row; stamps superseded_at.

GET    /admin/pl   revenue_cents now comes from location_revenue (§2.5)
```

New validator:

```js
/**
 * A Vienna calendar MONTH on the wire, "YYYY-MM". Returns "YYYY-MM-01" as a STRING, handed
 * to Postgres as a `date` — the same reasoning as isoDate(): turning it into a JS Date
 * re-introduces the timezone question the DATE type exists to avoid.
 */
export function isoMonth(value, field) { /* ^\d{4}-\d{2}$, year 2000..2100 */ }
```

**Future months.** A payment for a month that has not started is usually a typo in the year.
It is not *always* — cleaning contracts are prepaid. Rule: accept up to **the next Vienna
calendar month**, refuse beyond with `422 month_too_far_ahead`. That catches `2027-09` typed
for `2026-09` while allowing a legitimate January prepayment entered in December. A judgement
call, named as one.

Money: integer cents on the wire, parsed by the existing `parseEuroToCents` in
`web/lib/money.ts`. No float multiply anywhere; the only division is `revenue / m²` in §3.6
and it is `numeric` in SQL, rounded once.

## 2.9 Admin UI shape

`/pl/` gains **one** control and **one** cell. It does not gain a screen.

- **cell** on each building row: the figure with its provenance line, or „nicht eingetragen"
  plus an „eintragen" button.
- **control**: the existing `Drawer` pattern, opened per building, containing one row per
  Vienna month in the selected period — so the director fills a quarter in one visit rather
  than reopening a dialog three times. Each row: month label, amount input (pre-filled with
  the contract suggestion, visibly labelled), optional note, and the provenance line for
  months already entered.
- **390 px**: the drawer is a stacked list of month blocks, never a wide table. The building
  row's revenue cell wraps to two lines (figure / provenance) rather than truncating.

Every string externalised, de/en exact parity, Austrian business German („Jänner", „Umsatz",
„eingetragen", „geändert"), and every plural through ICU.

Effort: **high.** New table, 3 routes, a real editor, and a rewrite of the P&L's revenue
half including the period-alignment rule.

---

# 3 · ZONES, AND A TAG POINTS AT A ZONE

## 3.1 The table

```sql
CREATE TABLE zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  note            TEXT,                       -- WHERE the tag physically is. W10/D2 read it.
  area_sqm        NUMERIC(8,2) CHECK (area_sqm > 0),   -- NULL = nobody has measured it
  tag_serial      TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),
  tag_deployed_at TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`area_sqm` is NULLable, and that is the whole point.** A zone nobody has measured is real —
"Stiege 3, there is no floor plan". If area were required the director would invent a number,
and an invented m² poisons the €/m² benchmark that is the only reason the column exists.
NULL is not 0 here either: the building's total is reported as *"mindestens 420 m² (2 von 5
Zonen ohne Fläche)"*, never as a total that pretends completeness.

`NUMERIC(8,2)`, not a float: exact decimal, same discipline as money, so a sum of areas is a
sum and not a rounding argument. Not integer cents-equivalents, because area is not money and
half a square metre is the finest anyone quotes.

**The building has no area column.** `SUM(zones.area_sqm)` is derived at read time — 005's
standing rule that a derivable fact is not stored, because a stored copy drifts the first
time a zone is resized.

Indexes and constraints:

```sql
CREATE INDEX zones_location_id_idx ON zones (location_id);

-- One live "Eingang" per building. Partial, so retired zones pile up as history and a name
-- can be reused. Same shape as location_contracts_one_current_idx.
CREATE UNIQUE INDEX zones_one_live_name_idx
  ON zones (location_id, lower(btrim(name))) WHERE active;

-- A physical tag is in exactly one place. Two zones claiming one serial is a data error,
-- not a tie to be broken at tap time.
CREATE UNIQUE INDEX zones_tag_serial_idx ON zones (tag_serial) WHERE tag_serial IS NOT NULL;

-- Needed by the composite FKs below.
ALTER TABLE zones ADD CONSTRAINT zones_id_location_key UNIQUE (id, location_id);
```

Still rejected, unchanged from decision-37: a `tags` table (one row per zone forever, carrying
nothing the zone lacks); a self-referencing `locations` tree (a room would inherit `slug`,
`lat/lng`, `client_id`, a contract and a `portal_grant`, and every `WHERE active` over
`locations` would start returning rooms); `floor` (it is part of the name); `sort_order`;
`last_tapped_at` (derivable); `is_default` (only needed if the migration invented a zone,
which it does not).

## 3.2 A shift stays BUILDING-level — derived, not inherited

The owner's reading is `shifts.zone_id` nullable with `location_id` authoritative. Derived
independently, the conclusion is the same with one refinement: **two** columns, not one.

```sql
ALTER TABLE shifts
  ADD COLUMN start_zone_id UUID,
  ADD COLUMN end_zone_id   UUID,
  ADD CONSTRAINT shifts_start_zone_fk
    FOREIGN KEY (start_zone_id, location_id) REFERENCES zones (id, location_id),
  ADD CONSTRAINT shifts_end_zone_fk
    FOREIGN KEY (end_zone_id, location_id)   REFERENCES zones (id, location_id);
```

**Why building-level.** One shift per zone produces: a payroll row per room; a client portal
that exports our internal building structure (§3.7); the 2000-row `SHIFT_PAGE_MAX` window
divided by the zone count (~10 weeks of history becomes ~2 at five zones); and **2N taps per
visit instead of 2**, against W3 (clock in) and W5 (clock out), the two highest
frequency×pain journeys in `JOURNEYS.md` — where the worst incident on record is a worker who
could not make his *second* tap.

**Why two columns and not one.** One `zone_id` cannot answer "which door do people actually
leave by", which is a real maintenance question and the reason the `note` column exists at
all. Two nullable columns cost two `ALTER TABLE … ADD COLUMN` with no default and no rewrite,
and they are never inputs to money — the same standing as `material_requests.location_id`
under decision-6.

**Why composite FKs, `MATCH SIMPLE`.** With `location_id NOT NULL` and the zone column
nullable, the constraint is simply not checked while the zone is NULL and is fully checked
once it is set. The database itself then guarantees a shift can never name another building's
zone. Consequence, and it is not optional: **`PATCH /admin/shifts/:id` must clear both zone
columns in the same statement when `location_id` changes**, or the update raises `23503`.
Clearing is also the correct semantics — a human re-pointing a shift is saying the tap record
was wrong.

## 3.3 The second tap in the same building

**Any zone of the same building closes the shift.** Retained from decision-37 and re-argued,
because it is the rule most likely to be revisited:

```
resolve tapped place -> (building B, zone Z|NULL)

no open shift                  -> open at B, start_zone_id = Z
open shift, same building B    -> CLOSE it, end_zone_id = Z, auto_closed = false
open shift, a different building-> close old with auto_closed = true, open the new (decision-10)
```

| | (i) any zone closes — CHOSEN | (ii) only the opening zone closes |
| --- | --- | --- |
| mid-shift "log" tap | ⚠ ends the shift early | ✓ ignored |
| clocking out at another door | ✓ works | ✗ walk back to the opening tag |
| worst case | a short shift + a second shift, both visible, D6 corrects | **no reachable way out** — INCIDENT 1, an 8 h phantom shift |

An early close is recoverable with a full audit trail. An unclockable-out worker is the
highest-pain failure this system has had. The asymmetry decides it.

Two obligations follow and are not optional:

1. the running screen states in words what the next tap does — „Der nächste Tag-Kontakt in
   diesem Objekt – egal welcher – beendet die Schicht." de/en key parity.
2. **zones are opt-in per building.** A building with zero zones behaves exactly as today.

**The sequencing constraint has shrunk since decision-37.** The shipped build compares raw
tag ids, so it reads an intra-building zone tap as a *building switch*: `auto_closed = true`
plus a new shift on every tap. decision-37 called this landmine #1 because Play's internal
track offered no way to force an update. That is no longer the situation: there is **one**
phone in the field carrying a sideloaded APK, and `adb install -r` puts a new build on it in
seconds while preserving the worker session. The order is unchanged; its cost is not:

```
1  apply 006                          zero zone rows created, no behaviour change
2  server: activePlace() + roster.zones + admin CRUD
3  admin: zone list, per-zone tag URI, area
4  Android: buildingOf() switch rule + zone name on the running screen  -> new APK
5  `adb install -r` on the field phone; confirm the build            <- now one action
6  ONLY NOW a second physical tag in any building
```

Step 6 before step 5 still produces a flood of unresolved, unpaid shifts. The admin surface
must say so until step 5 is confirmed.

## 3.4 ⚠ What a BUILDING uuid resolves to once zones exist — THE LANDMINE

The card on the wall carries `https://timesheets.exe.xyz/t?l=c3c37d4a-ca0a-42c5-b248-9704b9907ec7`,
a **building** UUID, and it resolves again as of this week. HOIV has **zero zones**.

The owner's rule "a building with no zones is INACTIVE, shown on the map in grey" is a
**presentation** rule. If it is ever implemented as an operational one, the tag that was just
resurrected dies on the day migration 006 lands. Two different words, kept apart on purpose:

```
locations.active   OPERATIONAL. Unchanged. A building tag resolves iff this is true.
zone_state         DERIVED, PRESENTATION ONLY.
                     'zoned'   >= 1 active zone
                     'unzoned' 0 active zones  -> GREY pin + „Noch keine Zonen — Fläche unbekannt"
                   It NEVER affects tap resolution, payroll, the P&L or the portal.
```

Resolution, one query, exactly one row or a refusal:

```sql
-- lib/validate.js: activeLocation() becomes activePlace()
SELECT z.id AS zone_id, z.name AS zone_name, l.id AS location_id, l.slug, l.name
  FROM zones z JOIN locations l ON l.id = z.location_id
 WHERE z.id = $1 AND z.active AND l.active
UNION ALL
SELECT NULL, NULL, l.id, l.slug, l.name
  FROM locations l
 WHERE l.id = $1 AND l.active;
```

```
an ACTIVE zone of an ACTIVE building  -> (location_id, zone_id)
an ACTIVE building                    -> (location_id, NULL)      <- THE CARD ON THE WALL
                                         for ever, zoned or not
neither                               -> 422 unknown_location     (code UNCHANGED — the
                                         build in the field renders any new code as
                                         "unknown status from a newer server")
> 1 row                               -> refuse. Reachable only by a UUIDv4 collision
                                         across two tables; one line, and it is the
                                         difference between a refusal and silently
                                         picking a building.
```

A building UUID **never** resolves to "the first zone" or "the default zone". Picking one
would fabricate a tap location, and it would silently change meaning the day a second zone is
added.

**The check, with its RED case seeded:**

```
seed   an ACTIVE building with ZERO active zones            (exactly HOIV's shape)
tap    POST /shifts/open { location_uuid: <that building uuid> }
green  201, shift.location_id = that building, start_zone_id NULL
RED    add `AND EXISTS (SELECT 1 FROM zones …)` to the resolver -> 422 unknown_location
       i.e. the check fails the moment anyone conflates unzoned with inactive
```

That mutation must be run and shown failing. It is the single cheapest insurance against
re-killing a tag on a wall.

## 3.5 Creating a building no longer walks through tag writing

Today `/locations/` is a two-step drawer and the tag URI is rendered on the building row —
`REDESIGN-INVENTORY` §5 calls it "the single most load-bearing control on the screen".

New shape:

```
BUILDING drawer
  step 1  name, slug, address, lat/lng, client, contact          (unchanged)
  step 2  contract: monthly value, target minutes                (unchanged)
  step 3  OPTIONAL — „Erste Zone anlegen": name, m2, note
          skip -> the building is saved UNZONED, grey on the map, with a named next action

  NO TAG URI ON THIS PATH. Creating a building no longer produces a sticker to write.

ZONE drawer (from the building panel, or step 3)
  name · m2 (optional) · note (where the tag physically is)
  THEN the tag walkthrough, which is the SAME control as today's, repeated per zone:
    the zone's URI verbatim in a code-block + one-click copy + the UUID underneath
    „mit NFC Tools schreiben · NICHT sperren" (decision-15)
    [ Tag angebracht ] -> tag_deployed_at
  OR  adopt an existing tag: type its serial (§4)
```

**The building keeps a read-only building-tag disclosure, and it must not be dropped.** The
card on the wall carries a building UUID. If the building-level URI disappears from the admin
entirely, the director cannot see what the live card says and cannot re-write it if the card
is lost. So:

```
Gebäude-Tag (Bestand)                                    [ ▸ anzeigen ]
  https://timesheets.exe.xyz/t?l=c3c37d4a-…
  Nur für bereits angebrachte Tags. Neue Tags tragen eine Zone.
```

Collapsed by default, never the primary control. That stops new building-level tags being
minted out of habit while keeping the existing one visible and reproducible.

`web/lib/tag.ts` already builds the URI on the permanent tag host (decision-40). Zone URIs go
through the same function — one place, and it is already gated by a format check.

## 3.6 Does per-m² cost become possible? Partly — and the boundary is load-bearing

**YES at the BUILDING**, and this is what makes zones worth having:

```
building_m2      = SUM(zones.area_sqm) WHERE active
EUR/m2/month     = revenue_cents / building_m2            (numeric in SQL, rounded once)
minutes/m2/month = labour_minutes / building_m2
cost/m2/month    = (labour_cents + material_cents) / building_m2
```

These are defensible and they answer the question the director actually has when quoting a
new building: *"what do we charge and what does it take, per square metre, at comparable
buildings?"* Today there is no denominator at all.

Guard rails, and they are not decoration:

- any active zone with `area_sqm IS NULL` ⇒ every per-m² figure is **NULL**, reason
  `area_incomplete`, and the building's area renders as „mindestens X m² (N Zonen ohne
  Fläche)". A denominator that is silently too small inflates every per-m² number.
- an unzoned building has no area at all ⇒ per-m² is NULL, reason `no_zones`. Not 0.

**NO at the ZONE, and it must be refused explicitly.** A shift is building-level, so no
duration is attributable to a zone. The tempting move — split the building's labour by area
share — asserts that time is proportional to floor area, which is false in the obvious
direction: a Tiefgarage is fast per m² and an office floor is slow. Splitting cost by area
would produce a per-zone P&L nobody can defend, derived from a measurement this system does
not take. Same failure decision-6 already refused for materials.

What a zone CAN answer: *"the Tiefgarage tag has not been tapped since 14 May"* (from
`start_zone_id`/`end_zone_id`), and *"this building is 420 m² across 5 zones"*. Per-zone
duration remains the named upgrade path: a `shift_zone_visits` child table, which needs a tap
at every zone boundary and is its own decision with a real cost at the door.

## 3.7 Does a zone leak anything through the GDPR-minimal portal? It must not

The portal payload is `{ building: {name}, cleanings: [{date, first_name, minutes}] }`,
unauthenticated, token-in-URL, and its minimality *is* the lawful-basis argument written at
the top of `routes/portal.js`.

**Neither a zone name nor an area may ever enter it.**

- a **zone name** is internal building structure. „Tiefgarage · Stiege 1–3 · Büro 2. OG"
  handed to an outsider is a map of the site, and it arrives via a link that will be
  forwarded, screenshotted and pasted into a group chat (the route says so itself).
- an **area** is commercially sensitive: m² plus the contract value is our price per square
  metre, in the hands of the party negotiating it. It is also not needed to answer "was my
  building cleaned".
- a **zone id must never be grantable.** `portal_grants` references `location_id`. Nothing
  may add a zone-scoped grant — it would hand a client a link to a stairwell.

Pinned by a check, not by a promise, in the style of `check-api.js`'s existing redaction
assertions: seed a building with two named zones and an area, fetch the portal payload,
assert the response body contains neither zone name, no `zone` key, and no `area`. Show it
RED by adding a zone name to the select list.

## 3.8 Zone-less history

**Nothing happens to it. Zero backfill, zero invented rows.**

`start_zone_id IS NULL` reads as *"a building-level tag was tapped, or this shift predates
zones"* — one predicate, no third flag, the rule `001` set. Payroll, the P&L, analytics, the
portal and the autoclose SQL are unchanged byte for byte; every one of them already groups by
`location_id`.

Production has **0 shifts**, so in practice there is no history to preserve at all — but the
rule is written for the demo database, restored dumps and the months after next week.

**Rejected: backfill a default zone per building.** Nobody knows which door the HOIV card is
on, and a row saying `Eingang` would be a fabricated measurement in a payroll database. `005`
refused the identical move for contracts.

Where a zone label is absent, screens say so in words — `zoneNone` „Gebäude-Tag (keine Zone)"
— never a blank cell and never an invented name.

---

# 4 · SERIAL TAGS BECOME DATA

## 4.1 The tag, and what is true about it

```
NXP Mifare Ultralight EV1   serial 04:A1:A8:52:AE:5C:80   mounted at HOIV by someone else
one application/ase.mobile record, payload = the byte 0x31, NO URL
NDEF capacity 46 B   our URI needs ~64 B   ∴ it CANNOT be rewritten to carry ours
```

A tag with no URL cannot wake a closed app: there is no universal link for the OS to match,
and no app-side code changes that. **An adopted tag only ever works through the in-app Scan
screen.** That is not a limitation of our implementation; it is what the hardware is.

Today `android/nfc/KnownTags.kt` hardcodes serial → location UUID and `ScanActivity:147`
synthesises the URL. Adopting a second tag means a new APK on every phone. The file's own
comment: *"acceptable for one tag and absurd for twenty"*.

## 4.2 The column, not a table

`zones.tag_serial TEXT`, unique where not null, format-checked as uppercase colon-separated
hex — the normalised form every reader prints and the form `KnownTags.locationIdFor` already
produces.

`ponytail:` one adopted serial per zone. There is exactly one adopted tag in the world.
CEILING: a zone with two doors and two foreign tags cannot be expressed; neither can "this
tag was replaced in March". UPGRADE PATH: a `zone_tag_serials` child table, which is the
`tag_serials`-beside-`locations` path `KnownTags.kt` itself names.

A serial maps to a **zone**, not to a building. That is what forces HOIV's first zone to be
created by a human who knows which door the card is on — a fact a person enters, not one a
migration invents.

## 4.3 The lookup: `/roster`, and NO new endpoint

The brief asked for a lookup endpoint with a trust boundary, a rate limit, an unknown-serial
answer and an anti-enumeration argument. **The endpoint is not built.** Climbing the ladder
before writing it:

1. *Needed at all?* An adopted tag has no URL ⇒ the only path is the in-app Scan screen ⇒
   **the app is already open and already authenticated when a serial is read.** It can
   refresh the roster right there.
2. *Already-installed mechanism?* `GET /roster` exists, is `auth: "worker"`, is fetched by
   `ShiftSync` on launch, and its result is persisted in SQLite by
   `ShiftStore.replaceLocations` — so it already works offline on a cold launch.

∴ `/roster` gains one additive array and nothing else is built:

```json
{ "worker":   { "id": 1, "name": "…" },
  "locations":[ … unchanged … ],
  "zones":    [ { "id": "…", "location_id": "…", "name": "Haupteingang",
                  "tag_serial": "04:A1:A8:52:AE:5C:80" } ] }
```

Additive and safe for the build in the field: `Api.kt:92` reads
`get("/roster").getJSONArray("locations")` and ignores everything else.

The brief's questions, answered about `/roster`:

| Question | Answer |
| --- | --- |
| **trust boundary** | `auth: "worker"` — X-App-Key **and** a valid worker session cookie. A stranger cannot call it at all. Unchanged boundary; no new one is created. |
| **a serial never authenticates** | Stronger than an endpoint could make it: **the serial never reaches the server.** The phone matches it locally, then sends the resolved place UUID to `POST /shifts/open`, which resolves it server-side against `zones`/`locations` exactly as today, and takes the worker from `session.workerId` (decision-22). A cloned serial buys a clock-in at that building **as yourself** — precisely what a cloned URL tag already buys (decision-15). **No new attack surface.** |
| **rate limit** | None added, because no new route is added. `/roster` is session-gated; the app calls it on launch and on Scan. If it ever needs one, `checkLoginRate`/`recordLoginFailure` in `lib/auth.js` already provides the bucketed limiter the portal reuses as `portal:<ip>`. |
| **unknown serial** | It is simply not in the array. The Scan screen shows „Unbekannter Tag" plus the serial in copyable form (so the director can be told it) and posts **nothing** — the same terminal state `KnownTags.locationIdFor` returning null reaches today. |
| **cannot enumerate zones** | Enumeration is moot: a signed-in worker is already entitled to the active building list, and their own workplaces' zone names are less than that. The payload is bounded by `WHERE active`. It is *not* public, *not* reachable with the app key alone, and it never contains an area, a rate, a contract or a client. |

`ponytail:` the roster grows linearly with zones — ~50 buildings × 6 zones ≈ 300 rows ≈ 30 KB
per launch. CEILING: at a few hundred buildings this becomes a real payload. UPGRADE PATH: a
targeted `GET /tags/:serial` (session-gated, `checkLoginRate`-bucketed, 404 with no detail on
a miss) — the endpoint the brief described, built the day the roster crosses ~100 KB.

**This is a deviation from an explicit instruction and the owner may overrule it.** The
component asked for is designed above as the named upgrade path; what is proposed is that it
not be built yet.

## 4.4 Deleting KnownTags WITHOUT the row strands the mounted tag — plainly

```
delete KnownTags.kt   AND   no zone carries 04:A1:A8:52:AE:5C:80
  -> ScanActivity resolves nothing
  -> the only working tap at the only live building STOPS WORKING
  -> no site visit fixes it; only a new APK or a database row does
```

The order is not negotiable:

```
1  migration 006 (zones + tag_serial)
2  server: /roster carries zones[]
3  admin: create HOIV's first zone; type 04:A1:A8:52:AE:5C:80 onto it
4  VERIFY on the wire: GET /roster contains that serial -> that zone -> HOIV   <- THE GATE
5  Android: resolve the serial from the cached roster; DELETE KnownTags.kt;
   delete android/checks/known-tags-check.kt and its block in android/checks/run.sh;
   new APK (versionCode 4)
6  adb install -r on the field phone; tap the mounted tag once to confirm
```

Steps 1–4 are safe at any time: the compiled fallback still resolves while they land.
**Step 5 before step 4 is the stranding.**

One residual hole, small and real: `ShiftSync` swallows a roster fetch failure silently, so a
**fresh install whose very first roster fetch failed** would have an empty zone cache and no
compiled fallback. Enrolment itself requires the network, so the window is narrow but not
empty. Mitigation, and it belongs in the same task: fetch the roster as part of enrolment
redemption and retry on every foreground, so "signed in but never saw a roster" is not a
reachable resting state.

## 4.5 What the admin surface must say

- the serial field on the zone drawer, with the format shown („04:A1:A8:52:AE:5C:80") and
  normalisation on input, so any casing or separator style pastes cleanly.
- a plain sentence next to it: **„Ein übernommener Tag ohne URL kann die App nicht von selbst
  öffnen. Er funktioniert nur über ‚Scannen' in der App."** The worker must not discover this
  at a door.
- `409` when the serial is already claimed by another zone, naming that zone.

---

# 5 · The verification tap, again

D1 step 9 and IA-PLAN §8.4: a test tap creates a permanent, undeletable payroll row, and
there is no `DELETE /admin/shifts/:id` anywhere. The owner **deferred** this in IA-PLAN §9,
with a trigger: *"revisit when tags are deployed in bulk (more than one building, or zones
going in)."*

**Zones going in is the trigger, and it has fired.** Every zone added is one more verification
tap, so a five-zone building is five junk shifts. This design does not solve it — it is out of
scope here — but it must not be discovered at the wall. Either option (c) from §9 lands first
(a read-only „Tag prüfen" mode that names the place without posting a shift), or the zone
drawer's tag walkthrough states in words that the test tap creates a shift which must be
corrected afterwards. Filed as its own task.

---

# 6 · Migration sketch — `006_zones_revenue_rates.sql`, NOT WRITTEN, NOT APPLIED

House rules obeyed: additive only, every new column NULLable or DEFAULTed, **no
`BEGIN`/`COMMIT`** (`migrate.js` runs each file with `psql -1`), `001`–`005` untouched, no
down-migration (reversal is a new numbered file).

**One file or three?** One. All three schema changes are wanted before the client onboards
next week, `migrate.js` applies files atomically one at a time, and three files would create
three half-migrated states to reason about. The rate guard raises first, so a database that
cannot satisfy it gets nothing.

```sql
-- 006_zones_revenue_rates.sql
--
-- THREE owner decisions in one file, applied to an EMPTY production database (1 building,
-- 0 workers, 0 shifts) on purpose: this is the cheapest moment there will ever be.
--   decision-41  a worker's hourly rate is REQUIRED
--   decision-42  revenue is a typed, append-only monthly fact
--   decision-43  zones, with area; supersedes decision-37
--
-- ADDITIVE ONLY. NO BEGIN/COMMIT. No column is dropped and no column changes type.

-- ===========================================================================
-- 1 · decision-41 — a wage of zero is not a wage.
--
-- DROP DEFAULT is the load-bearing half: NOT NULL with DEFAULT 0 still silently lands a
-- zero on any INSERT that omits the column, which is the shape of seed.sql and of every
-- fixture in check-api.js. Without the default, an omitted column raises 23502 at the
-- point of the mistake.
--
-- The guard REFUSES rather than inventing. A migration does not get to choose somebody's
-- wage, and it does not get to deactivate them to avoid the question.
-- ===========================================================================
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM workers WHERE hourly_rate_cents <= 0;
  IF n > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('%s worker(s) have no hourly rate; refusing to invent one.', n),
      HINT    = 'Set every rate on /workers/ first, then re-run migration 006.';
  END IF;
END $$;

ALTER TABLE workers ALTER COLUMN hourly_rate_cents DROP DEFAULT;
ALTER TABLE workers ADD CONSTRAINT workers_rate_positive CHECK (hourly_rate_cents > 0);

-- ===========================================================================
-- 2 · decision-42 — what the client PAID, per building, per Vienna month.
--
-- NOT an accrual. location_contracts holds what was AGREED (a rate, with a validity range);
-- this holds what was RECEIVED (a scalar, for one named month). The P&L stops pro-rating a
-- monthly fee across arbitrary day ranges and starts reading a figure a human typed.
--
-- THE ABSENCE OF A ROW IS THE UNKNOWN. amount_cents is NOT NULL and 0 is expressible and
-- MEANS SOMETHING — "they paid nothing this month" is a real, different answer from "nobody
-- has told me". No nullable-amount column, because that distinction would then have to be
-- read correctly in four places instead of one.
--
-- APPEND-ONLY. Hand-typed money that changes invisibly is an opinion, not a fact. A
-- correction inserts a new row and stamps superseded_at on the old one; a retraction stamps
-- superseded_at and inserts nothing, so the month goes back to UNKNOWN rather than to 0.
-- Same idiom as location_contracts_one_current_idx and portal_grants_one_live_idx.
-- ===========================================================================
CREATE TABLE location_revenue (
  id             BIGSERIAL PRIMARY KEY,
  location_id    UUID NOT NULL REFERENCES locations(id),
  month          DATE NOT NULL,                    -- always the 1st; a Vienna calendar month
  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  note           TEXT,
  entered_by     BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at  TIMESTAMPTZ,                      -- NULL = the figure in force
  superseded_by  BIGINT REFERENCES admins(id) ON DELETE SET NULL,
  -- A DATE has no DST to get wrong (005's reasoning for valid_from/valid_to). EXTRACT is
  -- used rather than date_trunc so there is no doubt about immutability inside a CHECK.
  CONSTRAINT location_revenue_month_start CHECK (EXTRACT(DAY FROM month) = 1)
);

CREATE UNIQUE INDEX location_revenue_one_live_idx
  ON location_revenue (location_id, month) WHERE superseded_at IS NULL;

CREATE INDEX location_revenue_month_idx ON location_revenue (month, location_id);

-- NO BACKFILL FROM location_contracts. A contract is what was agreed; copying it in would
-- assert a payment that may never have arrived, which is the accrual this decision removes
-- wearing a different hat. The contract is offered as a SUGGESTION in the entry form and
-- stored only when a human presses save.

-- ===========================================================================
-- 3 · decision-43 — zones.
--
-- WHAT A ZONE IS: a place inside a building that gets cleaned and can carry a tag.
-- WHAT A ZONE IS NOT: a costing unit. A shift is billed to the BUILDING, and the contract
-- and the revenue stay on the BUILDING.
--
-- NO tags table: decision-5 made our own tags identity-free, so the only hardware with an
-- identity worth storing is an ADOPTED third-party tag, whose sole stable handle is its
-- serial — one column.
--
-- area_sqm IS NULLABLE ON PURPOSE. A zone nobody has measured is real, and a required area
-- would be an invented one. The building's area is SUM(area_sqm) computed at read time and
-- is reported as "at least X m2, N zones unmeasured" whenever any active zone is NULL.
-- NOTHING stores a building area: a derivable fact is not stored (005).
--
-- ZERO ROWS CREATED. A building with no zones behaves exactly as today and its own UUID
-- keeps resolving FOR EVER — the card physically on the wall at HOIV carries one.
-- "Unzoned" is a PRESENTATION state (grey on the map). It is NOT locations.active and must
-- never be wired to tap resolution.
-- ===========================================================================
CREATE TABLE zones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id),
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  note            TEXT,                                  -- where the tag physically is
  area_sqm        NUMERIC(8,2) CHECK (area_sqm > 0),     -- NULL = nobody has measured it

  -- ADOPTED HARDWARE ONLY. A tag we wrote has no row here: it carries this zone's id in
  -- its URL. This column exists because the tag at HOIV holds no URL at all and cannot be
  -- rewritten (46 B capacity, our URI needs ~64 B).
  -- A SERIAL IS NOT A CREDENTIAL (decision-15): broadcast in the clear, clonable. It never
  -- reaches the server on a tap — the phone matches it from the cached roster and sends the
  -- resolved place UUID, which the server resolves itself, with the worker taken from the
  -- session. Nothing may ever authenticate on this value.
  tag_serial      TEXT CHECK (tag_serial ~ '^[0-9A-F]{2}(:[0-9A-F]{2})+$'),

  -- NOT DERIVABLE, which is why it is stored: "a tag is on this wall, never yet tapped" and
  -- "there is no tag on this wall" are different states. LAST-tap time is NOT stored — that
  -- one IS derivable, from shifts.
  tag_deployed_at TIMESTAMPTZ,

  active          BOOLEAN NOT NULL DEFAULT true,         -- soft only; nothing destroys history
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX zones_location_id_idx ON zones (location_id);

CREATE UNIQUE INDEX zones_one_live_name_idx
  ON zones (location_id, lower(btrim(name))) WHERE active;

CREATE UNIQUE INDEX zones_tag_serial_idx ON zones (tag_serial) WHERE tag_serial IS NOT NULL;

ALTER TABLE zones ADD CONSTRAINT zones_id_location_key UNIQUE (id, location_id);

-- ---------------------------------------------------------------------------
-- shifts — two TAP FACTS, nullable, never an input to money.
-- NULL = a building-level tag was tapped, or the shift predates zones. One predicate, no
-- third flag (001's rule).
--
-- COMPOSITE FKs, MATCH SIMPLE: with location_id NOT NULL and the zone column NULLable the
-- constraint is not checked while the zone is NULL and is fully checked once it is set, so
-- the database itself guarantees a shift never names another building's zone.
-- CONSEQUENCE: PATCH /admin/shifts/:id must CLEAR both zone columns when location_id
-- changes, or the update raises 23503. Clearing is also the correct semantics.
-- ---------------------------------------------------------------------------
ALTER TABLE shifts
  ADD COLUMN start_zone_id UUID,
  ADD COLUMN end_zone_id   UUID,
  ADD CONSTRAINT shifts_start_zone_fk
    FOREIGN KEY (start_zone_id, location_id) REFERENCES zones (id, location_id),
  ADD CONSTRAINT shifts_end_zone_fk
    FOREIGN KEY (end_zone_id, location_id)   REFERENCES zones (id, location_id);

-- "when was this tag last tapped" — one row per zone in the building panel. Partial: the
-- column is NULL for all existing history and for every building-level tag, so the index
-- stays the size of the zoned shifts and not of the table.
CREATE INDEX shifts_start_zone_idx ON shifts (start_zone_id, start_time DESC)
  WHERE start_zone_id IS NOT NULL;
```

Applying this is: two `ALTER TABLE … ADD COLUMN` with no default (no rewrite), two `ADD
CONSTRAINT` validating against zero matching rows, one `DROP DEFAULT`, one `CHECK` over an
empty table, and two `CREATE TABLE`. Brief locks, no rewrite.

**Unvalidated by execution.** `psql --dry-run` does not exist; the first real check is
applying it to a scratch database. `server/db/check-migrate.js` is the harness.

---

# 7 · API surface, consolidated

## Worker-facing — the shipped APK must keep working

| Route | Change | Compatible with the build in the field? |
| --- | --- | --- |
| `GET /roster` | add flat `zones: [{id, location_id, name, tag_serial}]` | ✓ `Api.kt:92` reads `locations` and ignores the rest |
| `POST /shifts/open` | `location_uuid` keeps its name; its value may now be a zone UUID. Server resolves → `location_id` + `start_zone_id` | ✓ field name unchanged |
| `POST /shifts/close` | new **optional** `location_uuid` = the place tapped → `end_zone_id`; a different building → `422 wrong_building` | ✓ the shipped app never sends it |
| `GET /shifts/open`, `/shifts/unresolved`, `/shifts/mine` | add nullable `zone_name` beside `location_name` | ✓ additive |
| `POST /material-requests` | unchanged, stays building-level (decision-6) | ✓ |

`lib/validate.js: activeLocation()` → `activePlace()`, returning `{location_id, zone_id|null, …}`.
Every caller that wants only a building keeps reading `location_id`. **The error code stays
`unknown_location`.**

`ponytail:` `location_uuid` now carries a zone id, so the field name is a lie. CEILING named:
it is the cheapest correct thing while an APK is in the field. UPGRADE PATH: accept
`place_uuid` as preferred once both clients send it; keep `location_uuid` accepted for ever.

## Admin

```
POST   /admin/zones                 upsert {id?, location_id, name, note, area_sqm,
                                            tag_serial, tag_deployed_at}
                                    409 duplicate live name · 409 serial already claimed
DELETE /admin/zones/:id             SOFT deactivate. Never deletes; history keeps its FK.
DELETE /admin/locations/:id         must also deactivate the building's zones — an active
                                    zone under an inactive building is unresolvable and
                                    looks like a dead tag
PATCH  /admin/shifts/:id            must CLEAR both zone columns when location_id changes
GET    /admin/data                  zones[] joins the snapshot (+ derived last_tap_at)
POST   /admin/workers               v.requiredRate -> 422 rate_required
GET    /admin/revenue?from&to       the /pl/ month grid + contract suggestions
POST   /admin/locations/:id/revenue {month, amount_cents, note?}
DELETE /admin/locations/:id/revenue/:month     retract -> UNKNOWN, never 0
GET    /admin/pl                    revenue from location_revenue; per-m2 block;
                                    labour_unpriced_* fields GONE
```

## Portal — unchanged, and pinned by a check

`{ building: {name}, cleanings: [{date, first_name, minutes}] }`. No zone, no area, no
revenue, ever. §3.7.

---

# 8 · Admin UI shape, consolidated

```
/locations/   building drawer: step 3 „Erste Zone anlegen" (optional, skippable)
              building row: „Gebäude-Tag (Bestand)" collapsed, read-only
              zone list per building: name · m2 · Tag-Status · letzter Kontakt
              zone drawer: name · m2 · note · tag walkthrough OR adopt-by-serial

/            (map) unzoned buildings render GREY with „Noch keine Zonen — Fläche unbekannt"
              and a named next action. Grey is the SECOND signal; the words are the first.
              Building panel: area „mindestens X m2 (N Zonen ohne Fläche)", zone list.

/pl/          revenue cell: figure + „eingetragen <date> · <admin>" (+ „geändert … · vorher …")
              or „nicht eingetragen" + [ Umsatz eintragen ]
              revenue drawer: one block per Vienna month in the period, contract-suggested
              answer band: „Monate ohne Umsatz: N"
              per-m2 block, NULL with a named reason when any area is missing
              DELETED: the unpriced-labour flagged block and its method bullet

/payroll/     DELETED: the „Kein Stundensatz" row state, the no-rate answer-band sub-line,
              the no-rate caveat bullet, the CSV total note.
              KEPT: the CSV „Hinweis" COLUMN (decision-10 exclusions still live in it).

/workers/     rate field becomes REQUIRED (marked, and validated client- and server-side)
              DELETED: „Kein Stundensatz", rateOptionalHint (which is currently WRONG)
```

Every string externalised. de/en exact key parity via `web/scripts/check.mjs`. Austrian
business German. Every plural through ICU. 390 px verified (decision-28): the zone list and
the revenue month grid are stacked blocks, never wide tables. Colour is always the second
signal. **Nothing true is deleted to lighten a screen** — the only deletions here are of
statements that this design makes *false* (a rate-less worker) or *unreachable*.

---

# 9 · What breaks if we get this wrong

Worst first.

| # | Mistake | Cost | Recoverable? |
| --- | --- | --- | --- |
| 1 | **"unzoned" is wired to tap resolution** | the card on the wall at HOIV — zero zones — stops resolving the day 006 lands. The host resurrection is undone by a schema migration. | ✗ not without a code change and a redeploy; the tag is dead meanwhile |
| 2 | **`KnownTags.kt` deleted before a zone carries the serial** | the only working tap at the only live building dies. No site visit fixes it. | ✗ only a new APK or a database row |
| 3 | **A second active zone deployed before the zone-aware APK is on the phone** | every intra-building tap reads as a building switch: `auto_closed = true`, a new shift, the old one unpayable until resolved | yes, by hand, per shift |
| 4 | **The tag URI shape changes** (`?z=`, or dropping building-UUID resolution) | every tag on a wall is revisited. Today one; from next week, every client. | ✗ only by a site visit |
| 5 | **The migration invents a wage** (backfilling 0 → some number, or deactivating rate-less workers) | a figure nobody chose sits in a payroll column and is indistinguishable from a real one | ✗ |
| 6 | **Revenue is backfilled from the contract** | a payment that may never have arrived is asserted as received, and a human then sees it as confirmed. The P&L becomes fiction with an audit trail. | ✗ once believed |
| 7 | **Revenue is pro-rated across a ragged period** | a full month of revenue compared to a partial month of cost, reported as a margin | yes, but only after a client conversation has been had on it |
| 8 | **A shift per zone** | a payroll row per room; the portal exports our building structure; the 2000-row window shrinks by the zone factor; 2N taps per visit | ✗ not without re-aggregating history |
| 9 | **Zone names or areas reach the client portal** | an outsider learns the site layout and our price per m². The payload's minimality *is* the GDPR argument. | ✗ once sent |
| 10 | **Per-zone cost split by area share** | a per-zone P&L nobody can defend, from a duration this system does not measure | yes, after a decision has been taken on it |
| 11 | **The CSV `Hinweis` column deleted with the no-rate strings** | decision-10's exclusions vanish from the artefact that goes to the bank | yes, cheaply, if caught |
| 12 | **`rate_basis: "current"` deleted with the unpriced fields** | the one remaining true statement about labour valuation disappears; the P&L looks more certain than it is | yes |
| 13 | **`DROP DEFAULT` forgotten** | the CHECK passes for the API while `INSERT INTO workers (name)` still lands a 0 from any script | yes, if the SQL-path check exists |
| 14 | **Composite FK omitted** | a shift can name another building's zone; the panel lists it and it looks like data | yes, cheaply |
| 15 | **Zones deleted rather than deactivated** | `start_zone_id` dangles or history is destroyed | ✗ |
| 16 | **Building area stored instead of derived** | it drifts the first time a zone is resized, and the €/m² benchmark silently rots | yes |

---

# 10 · What this design deliberately does NOT do

- **no per-zone duration, cost, revenue, target or margin.** Money and time stay at the
  building. Upgrade path named: `shift_zone_visits`.
- **no worker↔zone assignment.** There is no worker↔building assignment either.
- **no zone in the client portal. Ever.**
- **no nested zones.** One parent building, no children.
- **no rate history.** decision-41 makes a rate exist; it does not make it period-correct.
  That remains `worker_rates` and its own decision.
- **no new lookup endpoint for serials.** §4.3, with the ceiling and the upgrade path named.
- **no revenue accrual, ever again** — including "helpfully" filling a missing month.
- **no in-app tag writing**, and **no fix for the verification tap** (§5) — both are related,
  valuable, separately tracked, and neither is a prerequisite.
- **no change to the 8 h auto-close, decision-10's resolution flow, or decision-6's pro-rata
  material split.**
- **no new npm dependency.** Server deps stay `pg` + `@sentry/node` (decision-23). No new
  systemd unit, no new timer.
- **no iOS work.** `NFCTimeSheets/` and `project.pbxproj` are untouched; the iOS host
  migration is already TASK-188.

---

# 11 · What did NOT happen in producing this document

- **Production was not touched.** No SSH, no query, no deploy.
- **No application code changed.** Nothing under `web/`, `server/`, `android/`,
  `NFCTimeSheets/`, `ops/`.
- **No migration file was created and none was applied**, not even to `nfc_demo`. The SQL in
  §6 exists only inside this file and is **unvalidated by execution**.
- **No decision was accepted.** decisions 41–44 are `proposed`. The owner accepts decisions.
- The production facts quoted (1 building, 0 workers, 0 shifts, 5 migrations, the pin at
  48.1761151/16.3953038, the card's UUID, the EV1 serial) are taken from the briefing and
  from IA-PLAN §9's verified read, **not re-verified this run**.
