---
id: decision-28
title: >-
  Contract history makes revenue period-correct; labour stays valued at current
  rates until a worker_rates table is accepted
date: '2026-08-03 15:30'
status: accepted
---
**ACCEPTED 2026-08-25 by the owner, AS WRITTEN — scope only.** This accepts what's already
shipped: contract history for revenue (migration 005), and labour staying valued at
`workers.hourly_rate_cents` (today's rate, no history) until a `worker_rates` table is
separately authorized. It does **not** authorize worker rate history. TASK-20 AC2/AC4 and
TASK-22 AC5 stay blocked until the four open questions below are answered and that answer
becomes an amendment (parallel to how decision-42 amended this one for revenue).

## Context

Migration 005 adds `location_contracts`: a building's price is now period-scoped
(`valid_from`, `valid_to`, Vienna calendar dates, half-open), so a March P&L uses the March
price even after a September increase. `GET /admin/pl` reads it. That fixes the **revenue**
line of the profit-and-loss report.

The **cost** line is not fixed, and cannot be fixed by anything in 005.

`workers.hourly_rate_cents` is a single mutable column with no history. Every labour figure the
P&L, the analytics screen and the payroll aggregate produce values *all* history at *today's*
rate. Give a cleaner a raise on 1 September and last March's labour cost silently changes; a
report the director printed in April no longer reproduces, with nothing on screen to say why.

This was known when the contract table was designed. It was deliberately not fixed in the same
change, because the fix is not symmetrical with it:

- `location_contracts` is a NEW table read by a NEW route. Nothing that existed before 005 reads
  it. Its blast radius is one screen that did not exist yesterday.
- `worker_rates` would have to be read by `GET /admin/data`'s `hours` aggregate, which is what
  the payroll screen pays people from. That is live money, for real people, in a product in
  daily use, on a box holding real shifts.

Numbering note: `decision-27` was taken by the Play Console record written in the same
iteration; this record is 28.

## Decision

**Ship contract history (done, migration 005). Do NOT ship worker rate history.**

Instead, state the limitation where it can be seen:

- `GET /admin/pl` returns `labour.rate_basis: "current"` and a German
  `labour.rate_basis_note`. The P&L and analytics screens must render this as a **permanent
  visible line**, not a tooltip and not a footnote.
- `server/README.md` and `server/db/README.md` say the same thing in prose.

Implementing rate history requires this record to be moved from `proposed` to `accepted` first,
and the accepted version must answer at minimum:

1. Does payroll (`GET /admin/data` `hours`) read rate-at-shift-time, or only the reports? If
   only the reports, the two disagree and the director will trust the wrong one.
2. What rate applies to a shift that predates the first `worker_rates` row? (Backfill the
   current rate at `valid_from = <the earliest shift>`, presumably — but that is a claim about
   history nobody verified.)
3. What happens to `workers.hourly_rate_cents`? Mirror of the current row, like
   `locations.monthly_contract_cents` is now — or dropped, which breaks the shipped iOS build's
   response shape?
4. Is a rate change retroactive by default? An admin fixing a typo in a rate means "this was
   always wrong"; an admin recording a raise means "from this date". Those are different
   actions and the buildings form already had to make the same distinction.

## Consequences

- The P&L revenue line is trustworthy across a price change. The cost line is trustworthy only
  as long as nobody's rate has changed, and the screen says so.
- A rate change today rewrites the labour cost of every past month in every report. Nobody is
  paid differently because of it — payroll pays the current rate on current hours either way —
  but a printed report stops reproducing.
- Payroll arithmetic is untouched by 005. That is the point: the one part of this system with
  real money attached did not change.
- If the answer to (1) above is "yes, payroll reads rate-at-shift-time", that change needs a
  backup, a reconciliation against the last payslip actually paid, and the director's sign-off
  — not a deploy.
