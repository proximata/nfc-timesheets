---
id: TASK-300
title: >-
  Payroll under-reports untapped shifts: caveatManual counts only admin-typed
  rows, not decision-56 manual ends
status: To Do
assignee: []
created_date: '2026-08-27 11:13'
labels:
  - web
  - payroll
  - decision-56
  - bug
dependencies: []
priority: medium
ordinal: 218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-291 (decision-56 review gate), 2026-08-27.

MEASURED STATE. web/lib/payroll.ts:103
  if (isManualEntry(shift)) line.manualShifts += 1
isManualEntry is client_uuid === null - an admin-typed row. manualShifts feeds two things:
  - the payroll CSV export column (app/payroll/page.tsx:371 per line, :383 total)
  - the on-screen caveat at :704, messages/*.json payroll.caveatManual, which says:
      en: 'N shifts in this total were entered by hand instead of being tapped on a tag. They are paid in full; the tag log has no record of them.'
      de: '... wurde von Hand erfasst und nicht am Tag eingelesen. ... im Tag-Protokoll gibt es dazu keinen Eintrag.'

That sentence is a claim about shifts THAT WERE NOT TAPPED ON A TAG. Since decision-56 a phone-originated shift can also have no tap on either end (manual_start / manual_close), has a client_uuid, and is therefore excluded from the count - while being exactly the population the sentence describes. The number shown to whoever signs off payroll is now lower than the truth it claims to state.

WHY THIS IS NOT JUST COSMETIC. decision-56 5: the flags 'get a small visible marker wherever shifts are listed/reported'. Payroll is the report. It is also the one screen where the count is used as an audit control rather than a label.

CONSTRAINT. Do not merge the two facts into one boolean. An admin-typed row and a worker-pressed-Stop row are different audit categories (lib/shifts.ts spells this out) and decision-56 1 splits manual_start/manual_close for the same reason. Either add a SECOND count, or make manualShifts explicitly 'no tap on at least one end' and reword both locales' caveat to match - decide which, do not do half.

CSV: the export column header and its meaning must change together with the number, or a finance sheet built on last month's export silently changes meaning.

ACCEPTANCE EVIDENCE. A payroll page over seeded data containing one admin-typed shift, one manual-start shift, one manual-close shift and one tap/tap shift, with the caveat text and the CSV column both quoted and both consistent with what the sentence claims.

MUST NOT REGRESS. blocksPayroll/shiftState untouched - decision-56 rows are payable exactly like any other (decision-56 Consequences). de/en parity and ICU plural arguments hold (pnpm verify).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 the payroll manual count includes decision-56 manual ends, or a second count is added, and the choice is stated in the code comment
- [ ] #2 caveatManual wording in BOTH en.json and de.json matches whatever the number now means
- [ ] #3 the CSV column header and value change together; the change is noted for anyone with an old export
- [ ] #4 seeded four-case screenshot + CSV line quoted; pnpm verify clean
<!-- AC:END -->
