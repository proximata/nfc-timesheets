---
id: TASK-195
title: '/pl/ revenue entry: a month grid, a provenance line, and never a silent zero'
status: To Do
assignee: []
created_date: '2026-08-19 13:58'
labels:
  - web
  - revenue
  - pl
  - i18n
  - a11y
dependencies:
  - TASK-193
  - TASK-194
documentation:
  - backlog/decisions/decision-42
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 113000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-42, the screen. ZONES-MODEL.md $2.3, $2.7, $2.9.

/pl/ gains ONE cell and ONE control. It does not gain a screen.

CELL, per building row:
  Umsatz  1.100,00 EUR
          eingetragen 03.09.2026 · schimmer
          geändert 11.09.2026 · schimmer · vorher 1.250,00 EUR      <- only when superseded
  or
  Umsatz  nicht eingetragen        [ Umsatz eintragen ]

'geändert' is a WORD, not a colour -- colour is always the second signal. The previous figure is
NAMED: 'this was changed' without 'from what' sends the director to the database.

CONTROL: the existing Drawer, opened per building, containing ONE BLOCK PER VIENNA MONTH in the
selected period, so a quarter is filled in one visit instead of reopening a dialog three times.
Each block: month label (Austrian -- Jänner), amount input PRE-FILLED with the contract
suggestion and visibly labelled as one, optional note, and the provenance line where a figure
exists. A retract action per entered month.

  Vertragswert für diesen Monat: 1.250,00 EUR — als Vorschlag eingesetzt, noch nicht bestätigt.

ANSWER BAND gains a cell that cannot be skipped:
  Monate ohne Umsatz    3     von 12 Objekt-Monaten im Zeitraum
and the period total is labelled INCOMPLETE in words. A total over some known and some unknown
revenue is not a total.

NEVER: a 0 where a month is unentered. NEVER: the contract figure rendered as if it were
revenue. Where the margin is refused (period_not_month_aligned) the screen says which months
were left out, by name.

MONEY: parseEuroToCents from lib/money.ts. Integer cents on the wire. No float multiply.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The revenue cell renders figure + provenance, or 'nicht eingetragen' + the action -- never 0,00 EUR for an unentered month
- [ ] #2 RED, seeded: a superseded figure renders 'geändert … vorher …' with the OLD amount. Drop previous_amount_cents from the payload -> the check goes red
- [ ] #3 RED, seeded: a period with 3 unentered building-months shows 'Monate ohne Umsatz 3' and the incomplete-total wording. Make the total silently sum the known months only -> red
- [ ] #4 RED, seeded: a ragged period names the excluded partial months and shows no margin. Restore a computed margin -> red
- [ ] #5 The suggestion is visibly a suggestion and nothing is stored until submit: opening and closing the drawer creates no location_revenue row
- [ ] #6 de/en exact key parity (web/scripts/check.mjs); Austrian business German; every plural through ICU
- [ ] #7 Renders at 1680 and at 390: the drawer is stacked month blocks, the revenue cell wraps to two lines rather than truncating its provenance
- [ ] #8 Keyboard + focus: the drawer traps focus, Escape closes it, and the save result is announced in the PAGE live region (Escape can close the drawer that reported it)
<!-- AC:END -->
