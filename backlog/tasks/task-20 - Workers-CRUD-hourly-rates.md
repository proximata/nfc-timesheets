---
id: TASK-20
title: Workers CRUD + hourly rates
status: In Progress
assignee: []
created_date: '2026-07-28 13:50'
updated_date: '2026-08-04 16:49'
labels:
  - web
milestone: m-3
dependencies:
  - TASK-15
  - TASK-2
priority: high
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Workers management page. List with current hourly rate. Add/remove workers. Set/update hourly rate per worker with effective_from date for history.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Add worker with name + hourly rate
- [ ] #2 Edit hourly rate preserves old rate with date range
- [x] #3 Remove worker (warn if shifts exist)
- [ ] #4 Rate history queryable for payroll at correct rate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TRIAGE 2026-08-04 — SHIPPED BUT INCOMPLETE. THE MISSING HALF IS PAYROLL-AFFECTING.

MET. `POST /admin/workers` and `DELETE /admin/workers/:id` are live (401 unauthenticated).
Production `workers` has 1 row with hourly_rate_cents = 15000 (EUR 15.00/h). AC1, AC3.
Frame: docs/media/admin-workers.png. The row also carries apple_sub and the enrolment-code
columns — see the Sign in with Apple and enrolment-code tasks.

NOT MET — AC2 and AC4. There is NO rate history. `\d workers` in production shows ONE mutable
column, `hourly_rate_cents`. No `worker_rates` table exists anywhere in the schema or the code.

WHAT BREAKS: every hours figure the payroll screen, the P&L and the analytics screen produce
values ALL history at TODAY rate. Give a cleaner a raise on 1 September and last March labour
cost silently changes; the report the director printed in April no longer reproduces. On a
payroll system that is the kind of discrepancy that gets argued about with a person.

This is not an oversight — decision-28 records it as a deliberate deferral, on the grounds that
`worker_rates` would have to be read by the `GET /admin/data` hours aggregate, which is live
money for real people. Note decision-28 is still `status: proposed`, not accepted.

The limitation IS stated on screen, in German, on both affected screens:
  payroll.caveatRateHistory — "Bekannte Einschränkung: Es wird nur ein Stundensatz pro
  Mitarbeiter gespeichert, vergangene Stunden werden daher zum heutigen Satz bewertet."
  pl.methodRates — same fact on the P&L.
So the number is never presented as something it is not. That is what makes deferring it
defensible rather than negligent.

TO CLOSE: `worker_rates(worker_id, rate_cents, valid_from, valid_to)` half-open on Vienna
calendar dates, mirroring `location_contracts` which already does exactly this for revenue;
then point the hours aggregate at it. MEDIUM effort, HIGH blast radius — it changes the
arithmetic of a system in daily use.
<!-- SECTION:NOTES:END -->
