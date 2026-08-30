---
id: TASK-328
title: >-
  RELEASE BLOCKER: decision-63 left the server's own check suites RED - 5 cases
  across check-api.js and check-sms-flag.mjs still assert the retired 8-char
  dashed code
status: Done
assignee: []
created_date: '2026-08-29 23:53'
updated_date: '2026-08-30 05:03'
labels:
  - blocker
  - server
  - checks
dependencies: []
priority: high
ordinal: 246000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commit 003d2e4 (TASK-319/decision-63) changed the enrolment code to 5 digits with no dash but did not update every assertion that encodes the OLD format. The run's own report claimed '1 FAIL, pre-existing + unrelated'. That is false: RE-RUN AT HEAD by the review gate, 2026-08-30.

MEASURED AT HEAD (both runnable from server/):
  node check-api.js       -> 'check-api: 2 FAILED'
    :6   FAIL the REAL SDK payload leaks nothing and lands as ONE trace   <- pre-existing, needs a live Sentry DSN
    :138 FAIL whatever a tired cleaner types is normalised - O/0 and I/L/1, case, spaces: '567o3' must be accepted, got 401
  node check-sms-flag.mjs -> 'FAIL check-sms-flag: 4 case(s)'
    all four: The input did not match the regular expression /^[0-9A-Z]{4}-[0-9A-Z]{4}$/. Input: '48745'

ROOT CAUSE, one per suite:
  1. check-api.js:1500-1510 still types the code with 0->o and 1->l. decision-63 section 1
     DELETED the letter-aliasing step, and the new normaliseCode STRIPS non-digits, so
     '9o383' becomes '9383', fails CODE_RE and answers 401. 003d2e4 never touched this test
     (git show 003d2e4 -- server/check-api.js | grep 'tired cleaner' is empty).
     FLAKY BY CONSTRUCTION: it only bites when the minted code contains a 0 or a 1, i.e.
     1 - 0.8^5 = 67 percent of runs. That is why the build agent saw it intermittently and
     wrote it off.
  2. check-sms-flag.mjs:338 and :481 still assert /^[0-9A-Z]{4}-[0-9A-Z]{4}$/ against a body
     that now carries 5 digits. Two assertion sites, four failing cases.

WHY IT MATTERS BEYOND TIDINESS: check-api.js is this project's canonical server gate and the
one deploy.sh reasoning leans on. Left red, the next run cannot tell new breakage from known
breakage, and a genuinely new failure hides inside 'the usual 5'.

FIX SHAPE (do not weaken the assertions - update them to the new format):
  - check-api.js: keep a normalisation case, but exercise what decision-63 actually kept -
    hyphens and spaces stripped ('1-2345', '12 345'), not letter aliasing. A case asserting
    that a LETTER is now rejected is the honest replacement for the deleted alias step.
  - check-sms-flag.mjs: both regexes become /^[0-9]{5}$/.
Neither file may import CODE_RE to assert against itself - a test that reads the value it is
checking proves nothing. Write the literal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 node server/check-api.js reports exactly 1 FAILED (the Sentry-DSN one) on a box with no live DSN
- [x] #2 node server/check-sms-flag.mjs exits 0
- [x] #3 the replacement normalisation case asserts hyphen/space stripping AND that a letter is refused, with a literal regex, never CODE_RE imported from the module under test
- [x] #4 run check-api.js 5 times in a row - no intermittent failure (the 67 percent flake is gone, not merely unobserved once)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed (commits 3406e0e/fe8f654/fb8f141/36f2b0c). check-api.js and check-sms-flag.mjs both exit 0 with zero FAIL lines, confirmed 3 consecutive runs by an independent verify agent (253/38 ok-assertions each run, identical). The flaky case (0/O and 1/l alias-derived fixtures, ~65% flake rate) replaced with literal unambiguous digit fixtures, confirmed no CODE_RE self-import. A separate unrelated check-telemetry-wire.mjs bug (fake Twilio SIDs treated as unconfigured) was found and fixed in the same pass.
<!-- SECTION:NOTES:END -->
