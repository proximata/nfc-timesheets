---
id: TASK-193
title: 'location_revenue API: type a month''s payment, correct it, retract it'
status: To Do
assignee: []
created_date: '2026-08-19 13:56'
updated_date: '2026-08-19 16:10'
labels:
  - server
  - revenue
  - pl
dependencies:
  - TASK-190
documentation:
  - backlog/decisions/decision-42
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-42, the API half. ZONES-MODEL.md $2.6 and $2.8.

ROUTES (server/routes/admin.js):
  GET    /admin/revenue?from&to               -> { months[], entries[], contract_suggestions[] }
  POST   /admin/locations/:id/revenue         { month:'YYYY-MM', amount_cents, note? }
  DELETE /admin/locations/:id/revenue/:month  retract -> the month reverts to UNKNOWN

APPEND-ONLY. Rows are NEVER UPDATEd in place:
  correction  INSERT a new row + UPDATE the previous SET superseded_at = now(), superseded_by
  retraction  UPDATE the current row SET superseded_at = now(), INSERT NOTHING
Retraction is not optional: if a figure lands on the wrong building, the only other way back is
'set it to 0' -- which asserts that a paying client paid nothing, in a report that drives
conversations with that client.

NEW VALIDATOR (lib/validate.js), beside isoDate:
  isoMonth(value, field)  ^\\d{4}-\\d{2}$, years 2000..2100, returns the STRING 'YYYY-MM-01'.
  Returns a string, not a Date, for isoDate's exact reason: a JS Date re-introduces the timezone
  question the DATE type exists to avoid.
FUTURE MONTHS: accept up to the NEXT Vienna calendar month, refuse beyond with
422 month_too_far_ahead. Prepaid cleaning contracts are real; a +1 cap still catches the
realistic typo, which is the wrong year. Judgement call, stated as one.

contract_suggestions come from location_contracts in force on that month. They are a
SUGGESTION for the form and are NEVER stored by this route. Nothing writes location_revenue
except an admin pressing save -- auto-filling from the contract is the accrual decision-42
removes, wearing a different hat.

entered_by comes from the admin session, never from the body (the decision-22 rule, applied to
the admin side).
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#2,#7,#8 -> D8 (is this building worth the contract?): revenue stops being derived from a contract and becomes something a human typed.
AC#3          -> D8: a month too far ahead is a typo, not a forecast.
AC#4          -> D12 (reprice a building) and D6 (correcting the past): a correction keeps the old figure visible, the same way a contract period does.
AC#5,#6       -> D8: „not entered" and „zero received" are two different answers and the client conversation differs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The three routes exist, admin-authed, and are listed in the route table
- [ ] #2 v.isoMonth exists with its own doc comment; '2026-9', '2026-13', 'abc' -> 400 invalid_month
- [ ] #3 RED, seeded: POST with a month two months in the future -> 422 month_too_far_ahead. Raise the cap -> the check goes red
- [ ] #4 RED, seeded: correct an existing figure -> the old row keeps its amount and gains superseded_at, the new row is in force, and the partial unique index still admits exactly one live row. Change the route to UPDATE in place -> the history assertion goes red
- [ ] #5 RED, seeded: retract a month -> GET /admin/pl reports revenue_cents null with reason not_entered, NOT 0. Make retraction write a 0 -> red
- [ ] #6 amount_cents = 0 is ACCEPTED and is reported as 0, distinctly from not_entered
- [ ] #7 entered_by is the session admin; a body-supplied entered_by is ignored
- [ ] #8 No new npm dependency; server deps stay pg + @sentry/node
<!-- AC:END -->
