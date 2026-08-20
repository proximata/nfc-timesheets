---
id: TASK-192
title: Delete the no-rate exclusion machinery -- and NOT the CSV Hinweis column
status: In Progress
assignee: []
created_date: '2026-08-19 13:55'
updated_date: '2026-08-20 04:03'
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
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#5,#6 -> D7 (month-end payroll ★): the exclusion machinery exists only in D7's output and is deleted there.
AC#2       -> W7+W8 (forget → auto-close → resolve): the CSV „Hinweis" column carries decision-10's unresolved shifts and MUST survive this deletion.
AC#3,#4    -> D8 (is this building worth the contract?): rate_basis = current is the last true statement about labour valuation; the pin makes „hours but no cost" impossible.
AC#7       -> D4 (daily check) and D7 at 390px (decision-28): a deleted column must not leave an empty cell behind.
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARTIAL at 8702615, and it is AC#4 that is not met (backlog/docs/VERIFY-FINAL.md).
DONE and verified: the deletion list is applied; the CSV Hinweis column SURVIVES (check-reports: 'the CSV still has its Hinweis column' - 7 columns, Hinweis last, and 'the CSV total row explains an exclusion, or has nothing to explain'); labour.rate_basis is still 'current' and /pl/ still renders the rate-history notice (check-money, check-reports); no test asserts 'Nicht bewertet'; pnpm check 1173 keys exact parity; audit-widths 420/420 at 11 widths x 2 themes including 390 with worst overflow +0px.
NOT DONE - AC#4 is FALSE, measured this session, not inferred:
  scratch copy of nfc_demo, one shift of exactly 1 second at Wohnhaus Wagramer Strasse
  GET /admin/pl?from=2026-08-20T01:39:00Z&to=2026-08-20T01:40:00Z
  -> labour_seconds = 1, labour_cents = 0
The invariant server/lib/reporting.js:308-310 states in its own comment, and that check-api.js:3126 asserts, is violated. check-api passes only because no fixture ever totals one second - a check whose negative case is absent from its own data. Scratch DB dropped.
The cause is ROUND(), not a missing rate: decision-41's ORIGINAL cause is genuinely unrepresentable (TASK-191). Deleting the 'Kein Stundensatz' copy was right and it stays deleted. The broader sentence it backed is what is still falsifiable.
REMAINDER: TASK-204, whose first acceptance criterion is seeding this condition so the existing assertion can go red.
<!-- SECTION:NOTES:END -->
