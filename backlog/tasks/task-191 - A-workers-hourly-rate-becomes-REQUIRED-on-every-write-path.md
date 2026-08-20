---
id: TASK-191
title: A worker's hourly rate becomes REQUIRED on every write path
status: Done
assignee: []
created_date: '2026-08-19 13:54'
updated_date: '2026-08-20 04:01'
labels:
  - server
  - payroll
  - validation
dependencies:
  - TASK-190
documentation:
  - backlog/decisions/decision-41
  - backlog/docs/ZONES-MODEL.md
priority: high
ordinal: 109000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-41, the API half. ZONES-MODEL.md $1.4 and $1.6.

THE DEFECT: validate.js:116 `cents()` does `(value ?? 0)`, so a worker created without a rate
silently costs EUR 0,00/h. Eleven lines below it, optionalCents() carries the comment that names
the bug -- 'NULL = nobody told me, 0 = free of charge'. Contract money got the distinction.
Wages never did.

ADD to server/lib/validate.js, beside cents/optionalCents:

  export function requiredRate(value, field = 'hourly_rate_cents') {
    if (value === undefined || value === null || value === '') fail(422, 'rate_required', field);
    const n = cents(value, field);   // shape only: 400 invalid_field on junk/negative
    if (n === 0) fail(422, 'rate_required', field);
    return n;
  }

  absent / null / ''  -> 422 rate_required, detail 'hourly_rate_cents'
  0                   -> 422 rate_required, detail 'hourly_rate_cents'
  junk / negative     -> 400 invalid_field  (UNCHANGED)

422 not 400 because the house line is already drawn: 400 = malformed shape, 422 = well-formed
and the business refuses it (unknown_location, end_before_start). ONE code for absent and zero:
the director does one thing about either, and two codes = two message keys x two locales
carrying one instruction.

DO NOT 'fix' requiredRange's 400 missing_field for symmetry. That is a live wire contract for
?from= and the divergence is recorded in decision-41 on purpose.

CALL SITE: routes/admin.js:374, `const rate = v.cents(body.hourly_rate_cents)` -> v.requiredRate.
That one variable feeds BOTH the INSERT and the UPDATE branch of upsertWorker. The UPDATE branch
is the path most likely to be missed: a worker created with a rate can be edited back to empty
from /workers/.

CLIENT SIDE: web/app/workers/page.tsx -- the rate Field stops being `optional`, gains
`required`, and '' no longer maps to 0 on submit; it becomes a client-side error keyed
workers.rateRequired. Server remains the gate; the client is a courtesy.

SEED/IMPORT PATHS, re-read all three: seed.sql (1450/1380/1520, OK), check-migrate.js:359
(1500, OK), check-api.js -- eight fixtures, and :2966 inserts 0 deliberately.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1..#5 -> D3 (hire a worker and issue a code): the rate is set at hire or the hire is refused, in the same 422 the director already reads.
AC#2,#3   -> D7 (month-end payroll ★, highest consequence): the empty-rate path is the one that reached payroll as a named exclusion.
AC#4      -> D14 („my hours are wrong"): a negative rate must keep its OWN error, or a typo reads as a policy refusal.
AC#6,#7   -> D3 on a phone (decision-28): the refusal must arrive before the submit, at 390px, in de and en.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 v.requiredRate exists with the three-branch behaviour above and its own doc comment
- [ ] #2 RED, seeded: POST /admin/workers {name:'X'} with no rate -> 422 rate_required, detail hourly_rate_cents. Revert the validator to v.cents -> 201. Same for {hourly_rate_cents: 0}
- [ ] #3 RED, seeded: POST /admin/workers with an id, editing an existing worker's rate to '' -> 422. The UPDATE branch is covered, not only the INSERT branch
- [ ] #4 POST /admin/workers with hourly_rate_cents = -5 still answers 400 invalid_field, not 422
- [ ] #5 check-api.js:2966's rateless fixture is converted into an assertion that the insert is REFUSED (23514)
- [ ] #6 web /workers/ rate field is marked required and refuses an empty submit client-side; message key exists in de.json AND en.json
- [ ] #7 web/scripts/check.mjs passes (de/en exact key parity)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 (backlog/docs/VERIFY-FINAL.md).
node server/check-api.js -> PASS. Every write path re-measured on a scratch restore (PROBE-DATA §5): INSERT omitting the column 23502 (006 drops the DEFAULT), explicit NULL 23502, 0/-1 23514 workers_rate_positive, UPDATE-to-0 23514, POST /admin/workers with rate absent/null/''/0 -> 422 rate_required naming the field, -5/'zwanzig'/1.5 -> 400 invalid_field, edit-to-empty 422 with the old wage intact. Constraint is convalidated = t, pg_attrdef for hourly_rate_cents = 0 rows.
cd web && pnpm check -> 1173 keys, exact de/en parity.
demo/probe-zones-revenue.mjs -> ok 'the hourly rate is marked required on the label AND the control' {marker:true, optionalWord:false, required:true} at 1680/1440x900/390, dark+light.
<!-- SECTION:NOTES:END -->
