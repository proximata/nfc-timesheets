---
id: TASK-164
title: >-
  Mitarbeiterpanel: /workers/?worker=<uuid> is the /workers/<id> that does not
  exist
status: In Progress
assignee: []
created_date: '2026-08-18 03:18'
updated_date: '2026-08-18 05:56'
labels:
  - ux
  - ia
dependencies:
  - TASK-160
documentation:
  - backlog/docs/IA-PLAN.md
  - backlog/docs/JOURNEYS.md
priority: high
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
JOURNEYS.md section 6 gaps 2 and 4: there is NO /workers/<id> route anywhere - web/app/ has no dynamic segment at all - and /workers/ has NO outgoing link. D5 ('I could not clock out', rank 3) and D14 ('my hours are wrong') both start with a person's name, and today the answer is: read the name off /shifts/, open /workers/, find them again, read the rate, go back.

The panel closes that loop, on a phone, in a stairwell - which is what decision-28 exists for. A query parameter on the existing route, not a new route (decision-38: the admin is a static export, decision-16).

CONTENTS:
 - open shift, if any: building, zone, since when, elapsed frozen at load with the asOf stamp, overdue as a WORD past 8 h, plus the one-click link that closes it
 - unbestaetigte Schichten: count and link, NO period filter
 - Zugangscode state: none | live | expired | redeemed | inactive, derived from enrolment_code_expires_at / _redeemed_at. It distinguishes 'never used' from 'used' and CANNOT distinguish 'typed it wrong nine times' from 'never opened the app' - say so, do not imply otherwise. Issue and revoke stay at the SAME visual weight (a code read to the wrong person is the expected failure and seconds matter), and the code is shown ONCE, inline, never in a modal - it is read down a phone while the row stays identifiable.
 - Stundensatz: a worker with no rate is a NAMED state, 'Kein Stundensatz', never 0,00 EUR. NOTE review defect R2: workers.rateOptionalHint currently claims payroll shows 0,00 EUR, which is the opposite of what payroll does. Fix that string in this task or reference the task that does.
 - active/inactive, with the offboarding trap made visible: if the worker has an OPEN or UNRESOLVED shift, deactivating destroys their sessions and they can never resolve it, so the shift is excluded from payroll for ever (W12/D11). Warn AT deactivation time, naming the shift.
 - last 10 shifts, payable / notPayable in words, originManual per row

FIVE CROSS-LINKS, each carrying state - IA-PLAN.md section 3, rows L12 to L16.

MUST NOT CHANGE: soft deactivation only, nothing deletes; the enrolment code panel stays inline; permanently mounted live regions stay mounted (no conditionally rendered toasts); de/en exact key parity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 D5: from any shift row, one click opens that worker's panel; from the panel, one click reaches /shifts/?worker=<id>&period=all&state=open&shift=<id>
- [ ] #2 D14: the panel lists the worker's last 10 shifts with payable/notPayable in words and originManual per row
- [x] #3 A worker with no hourly rate renders 'Kein Stundensatz' as a named state and never 0,00 EUR, and workers.rateOptionalHint no longer claims payroll values them at 0,00 EUR (review defect R2, both locales)
- [ ] #4 W12/D11: deactivating a worker who has an open or unresolved shift warns first, names the shift, and states that they will not be able to resolve it
- [x] #5 The enrolment code is still shown ONCE, inline, with its expiry visible at copy time, and is NOT in a modal or drawer
- [x] #6 /workers/?worker=<uuid> opened cold in a new tab renders the panel; an unknown uuid is ignored silently and renders the plain list
- [x] #7 de.json and en.json key sets stay byte-identical
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The panel shipped at /workers/?worker=<id>, sliced from the payload the screen already fetched (fetchWorkerSnapshot widens the type over the same /admin/data round trip - no new endpoint, no second request). Open shift, unconfirmed count, code state, rate as a NAMED state when 0, status, login email, last 10 shifts, the rate-history caveat, and 5 links each carrying state.

STILL OPEN, and neither is a filter-contract problem:
  AC#2 - the last-10 table shows when/where/duration but NOT payable / notPayable in words per row, and not originManual per row.
  AC#4 - deactivating a worker with an open or unresolved shift still does not warn and name that shift.

AC#1, #3, #5, #6, #7 verified in a browser (demo/check-filters.mjs): shift row -> panel in one click, panel -> /shifts/?worker=&period=all&state=open&shift=, 'Kein Stundensatz' never 0,00 EUR, the code panel still inline and shown once, /workers/?worker=<unknown> renders the plain list plus a chip that says so, de/en parity green.
<!-- SECTION:NOTES:END -->
