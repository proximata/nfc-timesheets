---
id: TASK-192
title: Delete the no-rate exclusion machinery -- and NOT the CSV Hinweis column
status: To Do
assignee: []
created_date: '2026-08-19 13:55'
labels:
  - server
  - web
  - payroll
  - i18n
dependencies:
  - TASK-191
documentation:
  - backlog/decisions/decision-41
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-41, the deletion half. Full file-by-file list: ZONES-MODEL.md $1.5.

Deleting is only safe because TASK-190 + TASK-191 make a 0 rate unrepresentable on all three
write paths. Do not start this before both are green.

*** TWO THINGS THAT MUST SURVIVE, and both are easy to sweep up by accident ***

1. THE CSV 'Hinweis' COLUMN STAYS. payroll/page.tsx builds it from ev(line), which concatenates
   THREE exclusions:
     excludedUnresolved '# zu bestätigen'   decision-10   STAYS
     excludedOpen       '# noch offen'      decision-10   STAYS
     excludedNoRate     'Kein Stundensatz'  decision-41   DELETED
   Deleting the column deletes decision-10's exclusion reporting from the artefact the director
   takes to the bank. Delete the no-rate CONTRIBUTION, plus csvTotalNoRate on the total row,
   plus the blanking of the CSV rate/amount cells (every row now carries both).

2. labour.rate_basis:'current' and rate_basis_note STAY in lib/reporting.js. They state a
   DIFFERENT, still-true limitation -- there is no rate history, so all labour is valued at
   today's rate. Deleting them with the unpriced_* fields makes the P&L look more certain than
   it is.

SERVER (lib/reporting.js): the FILTER (WHERE hourly_rate_cents <> 0) on the cost SUM; the
unpriced_seconds / unpriced_workers select entries in labourByLocation; the whole
unpricedLabour() function and its Promise.all slot; per-building labour_unpriced_seconds /
_minutes / _workers; top-level labour.unpriced_*; the header-comment bullet about a worker with
no hourly rate.

WEB: payroll/page.tsx (the noRate consts at ~262/318/352/770, the rateless line list,
answerExcludedNoRate, answerHoursUnvalued, the caveatNoRate bullet + link, rowNoRate,
amountNoRate, excludedNoRate inside ev(), csvTotalNoRate); workers/page.tsx (noRate,
rateOptionalHint -- which is CURRENTLY WRONG in both locales, and the 0 -> '' draft mapping and
the panel branch); pl/page.tsx (the unpriced-labour flagged block, its method bullet, every
labour_unpriced_* read); lib/api.ts types.

MESSAGES: delete the same keys from de.json AND en.json. Enumerate by grepping 'NoRate',
'noRate', 'unpriced', 'Unvalued'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every file in ZONES-MODEL.md $1.5 is edited; nothing on the KEEP list is touched
- [ ] #2 RED, seeded: the CSV export of a period containing one unresolved and one open shift still carries both reasons in the Hinweis column. Delete the column -> the check goes red
- [ ] #3 RED, seeded: GET /admin/pl still returns labour.rate_basis = 'current' and the /pl/ screen still renders the rate-history notice. Remove it -> red
- [ ] #4 New pin: for every P&L building, labour_seconds > 0 implies labour_cents > 0. Show it RED by re-adding a 0-rate worker directly in SQL with the CHECK dropped
- [ ] #5 check-api.js's replaced rateless test passes; no test still asserts 'Nicht bewertet'
- [ ] #6 web/scripts/check.mjs passes: de.json and en.json have EXACT key parity after the deletions
- [ ] #7 /payroll/, /pl/ and /workers/ render at 1680 and at 390 with no orphaned column, empty cell or dangling caveat bullet
<!-- AC:END -->
