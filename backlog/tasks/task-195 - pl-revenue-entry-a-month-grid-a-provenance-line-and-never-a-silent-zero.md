---
id: TASK-195
title: '/pl/ revenue entry: a month grid, a provenance line, and never a silent zero'
status: Done
assignee: []
created_date: '2026-08-19 13:58'
updated_date: '2026-08-20 04:02'
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
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#3,#4 -> D8 (is this building worth the contract?): the screen may not show a margin it cannot defend, and must name what is missing.
AC#2        -> D12 (reprice a building) and D6 (correcting the past): provenance is what makes a correction reviewable.
AC#5        -> D8: a suggestion the director did not confirm must not become a stored fact by being looked at.
AC#6        -> D8 in Austrian business German, de/en exact key parity.
AC#7,#8     -> D4/D8 on a phone in a stairwell (decision-28) and IA-A11Y: focus trap, Escape, announced result.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 (backlog/docs/VERIFY-FINAL.md), re-run against a bundle built WITH the maps key, server on :8080.
BASE=http://127.0.0.1:8080 node demo/probe-zones-revenue.mjs -> all geometry probes passed at 1680 / 1440x900 / 390, dark+light:
  'an unentered month says so and is never 0,00' - 6 rows: 1 unentered, 1 typed zero, 0 confusions
  'a typed 0 renders as an amount, not as the unknown' - 1 genuine zero
  '/pl/ says when a figure was entered, changed, and what it replaced' - {entered,changed,previous} all true
  'the contract value is NOT pre-filled into the amount' - value="" true, suggestion offered true (AC#5)
  'revenue drawer opens and takes focus' / 'Escape closes ... and restores focus' -> probe-rev-opener (AC#8)
  '/pl/ fits 390px - worst +0px' (AC#7)
AUDIT_BASE=... node demo/audit-overlays.mjs -> 88/88, pl:revenue trapped both ways.
The RED case for AC#1 is on the shelf and fires: mutating the answer band to money(0) FAILs on all 3 /pl/ routes.
<!-- SECTION:NOTES:END -->
