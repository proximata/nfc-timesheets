---
id: TASK-236
title: >-
  TASK-236: /pl/ is unanswerable on a fresh box -- bulk revenue entry, a
  reachable baseline suggestion, an offer to fix
status: Done
assignee: []
created_date: '2026-08-21 08:20'
updated_date: '2026-08-21 08:21'
labels:
  - scale
  - pl
  - server
  - web
dependencies: []
priority: high
ordinal: 154000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second-client scale pass. app_settings and location_revenue both ship EMPTY, so /pl/ reads 'nicht beurteilbar' forever until a director hand-types 8 buildings x 12 months = 96 cells through a one-drawer-per-cell form -- a design problem, not a data-entry one. Fixed: POST /admin/revenue bulk-saves many building-months in one request (two sequential bulk SQL statements, not one CTE -- a same-batch correction 500'd on the unique index when tried as one CTE, because Postgres runs every data-modifying clause of a WITH against one shared snapshot); /pl/'s ledger grows an inline field per blank cell, saved via a review-then-confirm bulk save bar, scoped to blank cells only so a stray keystroke can only create a wrong NEW row, never silently overwrite a correct one; the empty-baseline state offers a button straight to the baseline drawer and the drawer offers a 0% SUGGESTED placeholder (never auto-saved) as the one baseline value with no opinion in it. A month with no entry still never renders as 0,00 EUR.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /admin/revenue accepts {entries:[...]} and writes all-or-nothing
- [x] #2 a same-batch correction (create + correct in one request) round-trips correctly
- [x] #3 an unknown location_id in the batch refuses the WHOLE batch, nothing partially lands
- [x] #4 duplicate (location_id, month) pairs within one request are refused
- [x] #5 /pl/ ledger rows with no entry carry an inline field; rows with an entry are unchanged
- [x] #6 a bulk save shows a review modal naming every building/month/amount before POSTing
- [x] #7 the baseline drawer offers a 0% placeholder when unset, never auto-saved
- [x] #8 the blank-baseline empty state links directly to the baseline drawer
- [x] #9 server/check-api.js passes (5 new bulk-revenue cases); web pnpm check/tsc/build pass
- [x] #10 measured against 8 buildings x 12 months: 96 cells saved in one 42ms request
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Commits 75e11d7 (server bulk endpoint), ff49e5e (client UI). Measured in backlog/docs/SCALE-PROOF.md section 4.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
POST /admin/revenue bulk-saves N (location_id, month, amount_cents, note?) entries: two sequential bulk statements (UPDATE...unnest() then INSERT...unnest()), not one CTE -- a one-CTE version was tried first and 500'd a same-batch correction on location_revenue_one_live_idx because Postgres runs every data-modifying clause of one WITH against a single shared snapshot. All location ids validated to exist before anything writes; duplicate (location,month) pairs refused. web/app/pl/page.tsx: inline .cell-input field per blank ledger row, a bulk-save bar, and a ConfirmModal review naming every pending amount before the request goes out -- scoped to blank cells only, so the existing one-cell drawer (note + confirm) still owns every correction to an existing figure. Baseline drawer offers a placeholder='0' suggestion, never bound/auto-saved. Measured: 96-cell (8 buildings x 12 months) batch saved in one 42ms request against nfc_demo; 8 pre-existing rows correctly superseded, not lost; /admin/pl went from 0/8 to 8/8 assessable buildings. server/check-api.js PASS (5 new cases). web pnpm check/tsc/build PASS. Commits 75e11d7, ff49e5e, f444702; measurement in backlog/docs/SCALE-PROOF.md section 4.
<!-- SECTION:FINAL_SUMMARY:END -->
