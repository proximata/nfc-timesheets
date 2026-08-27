---
id: TASK-305
title: >-
  demo/check-shift-screen-brand.mjs exits 0 on every bail-out path, so a check
  that printed FAIL reports success
status: To Do
assignee: []
created_date: '2026-08-27 16:07'
labels:
  - demo
  - tooling
  - bug
dependencies: []
priority: medium
ordinal: 223000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the TASK-296 review gate, 2026-08-27, while re-running the check the gate is required to quote.

WHERE. demo/check-shift-screen-brand.mjs, main().

MEASURED STATE. Every pre-flight guard is written as bad(...) followed by a bare return:
    if (localRows() === '') { bad('the phone database is unreadable...'); return; }
    if (openShifts() !== '0') { bad('the phone already holds N open shift(s)...'); return; }
    if (openShifts() !== '1') { bad('the offline tap did not open a shift...'); return; }
    if (!/Eingestempelt|.../.test(xml)) { bad('the running screen is not what is on screen...'); return; }
The verdict line and process.exit sit AFTER the try/finally, inside main(). A return skips both. Observed, twice, on this machine:
    FAIL  the offline tap did not open a shift on the phone (open=0)
    EXIT=0
The finally still runs, so the cleanup is fine - it is only the exit status that lies.

WHAT BREAKS. Anything that reads the exit code rather than the prose: a CI step, a deploy gate, or a workflow agent instructed to 'run it and quote the result'. A run that never photographed the screen is indistinguishable from a run that measured it and found it achromatic. TASK-295 AC1 sat open for exactly this class of ambiguity.

FIX. One line each: replace the bare returns with a failure that reaches the verdict - either set failures and jump to a single exit point, or wrap main() so any bail-out exits non-zero. A bail-out is NOT a pass; it is 'not measured', and the only safe exit code for 'not measured' is non-zero.

CHECK THE SIBLINGS. check-app-not-wallpaper.mjs and the other demo/check-*.mjs written to the same template need the same read - the pattern, not just this file, is the defect.

ACCEPTANCE EVIDENCE. Force each bail-out (delete the app db, leave an open shift, dump a non-running screen) and show a non-zero exit for each, with the message unchanged.

MUST NOT REGRESS. The cleanup in finally must still run on every path - the phone is left with no rows, no armed job and the radio back on. A green run must still exit 0.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 every bail-out path exits non-zero; the verdict line is reached on all paths
- [ ] #2 each bail-out demonstrated red with its exit code quoted
- [ ] #3 the finally cleanup still runs on every path (rows deleted, job cancelled, radio restored)
- [ ] #4 the sibling demo/check-*.mjs files audited for the same bare-return pattern and fixed or explicitly cleared
<!-- AC:END -->
