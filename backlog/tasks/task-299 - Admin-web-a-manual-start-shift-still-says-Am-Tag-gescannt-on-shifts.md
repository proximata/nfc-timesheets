---
id: TASK-299
title: 'Admin web: a manual-start shift still says ''Am Tag gescannt'' on /shifts'
status: To Do
assignee: []
created_date: '2026-08-27 11:12'
labels:
  - web
  - decision-56
  - bug
dependencies: []
priority: medium
ordinal: 217000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by TASK-291 (decision-56 review gate), 2026-08-27, with a screenshot of a real local stack.

MEASURED STATE. web/app/shifts/page.tsx:1130
  {isManualEntry(shift) ? <span className='shift-origin-manual'>{t('originManual')}</span>
                        : <span className='shift-origin-tap'>{t('originTap')}</span>}
  {manualEnds(shift).map(...)}
isManualEntry is client_uuid === null, i.e. 'an admin typed this row'. A decision-56 manual open comes from a PHONE and therefore HAS a client_uuid, so it takes the else branch. The ART DER ERFASSUNG cell then reads, on one row, top to bottom:

  Am Tag gescannt
  Start manuell erfasst

The first line is false and contradicts the second. Verified on screen: three seeded rows (tap/tap, manual_start, manual_start+manual_close) rendered through the real Next.js export against a real /admin/data.

WHY IT IS NOT A DECISION VIOLATION. decision-56 5 asks for a visible marker and TASK-288's own ACs are all satisfied - the marker is there and the three cases are distinguishable. This is the copy being wrong next to it, which no AC covered.

CONSTRAINT THAT MAKES IT NON-OBVIOUS. Do NOT fold manual_start into isManualEntry. lib/shifts.ts says why in as many words: 'an admin typed this row' and 'the worker was on the phone but not on the tag' are different facts and an audit has to tell them apart. The fix belongs in the RENDER: suppress or reword originTap when manualEnds(shift) covers the start.

SUGGESTED SHAPE. originTap describes the START of the shift, so: show originTap only when !shift.manual_start; keep the per-end labels as they are. A shift tapped in and stopped by hand then reads 'Am Tag gescannt' + 'Ende manuell erfasst', which is exactly right.

ACCEPTANCE EVIDENCE. A screenshot of /shifts with four rows - tap/tap, manual-start-only, manual-close-only, both - where no row asserts both 'Am Tag gescannt' and 'Start manuell erfasst'.

MUST NOT REGRESS. isManualEntry keeps its current meaning and its payroll use. pnpm verify stays clean, de/en key parity holds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 no /shifts row shows originTap together with the manualStart label
- [ ] #2 an admin-typed row (client_uuid NULL) still shows originManual, unchanged
- [ ] #3 a tap-in/manual-out row correctly shows originTap + manualClose
- [ ] #4 screenshot of all four combinations attached; pnpm verify clean
<!-- AC:END -->
