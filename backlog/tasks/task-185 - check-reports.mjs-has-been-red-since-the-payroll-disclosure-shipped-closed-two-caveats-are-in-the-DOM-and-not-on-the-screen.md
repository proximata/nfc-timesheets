---
id: TASK-185
title: >-
  check-reports.mjs has been red since the payroll disclosure shipped closed:
  two caveats are in the DOM and not on the screen
status: To Do
assignee: []
created_date: '2026-08-18 19:34'
labels:
  - money
dependencies: []
priority: medium
ordinal: 103000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED while verifying TASK-176, and NOT caused by it: `demo/check-reports.mjs` has two
failing assertions against a build of HEAD.

  FAIL payroll: the rate-history caveat is visible (not merely in the DOM)
  FAIL payroll: the attribution rule is visible

Both are true statements about the screen. `payroll.caveatRateHistory` and
`payroll.attributionHint` live inside the `<details className="callout">` at the bottom of
web/app/payroll/page.tsx, which ships CLOSED. The check requires `offsetParent !== null`,
and it requires it on purpose: "a caveat inside a collapsed disclosure is a caveat nobody
reads, and document.body.textContent cannot tell the two apart" (its own header comment).

So this is not a broken check. It is two pieces of prose that a redesign moved behind a
disclosure and a check that was written to forbid exactly that, disagreeing since the
disclosure shipped -- which means the whole of check-reports.mjs has been exiting non-zero
for some time, and anything downstream that runs it has been reading a red run as normal.

THE DECISION TO MAKE, and it is a small one: either the rate-history limitation is
important enough to be visible on a payroll screen without a click (open the disclosure, or
lift that one bullet out of it), or the check should assert its PRESENCE and drop the
visibility requirement for these two lines specifically, with a comment saying which two
and why. Not both, and not silence -- a check that is permanently red is a check nobody
will believe when it goes red for a real reason.

Note that `caveatRateHistory` is the sentence that says every past month is priced at
TODAY's hourly rate. On the screen where money becomes a bank transfer, that is a strong
argument for the first option.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 demo/check-reports.mjs exits 0 against a build of the payroll screen
- [ ] #2 Either both caveats are visible without a click, or the check states in a comment exactly which two lines are exempt from the visibility rule and why
- [ ] #3 The rate-history limitation is not deleted and is not hover-only in either outcome
<!-- AC:END -->
