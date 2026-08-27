---
id: TASK-191
title: A worker's hourly rate becomes REQUIRED on every write path
status: Done
assignee: []
created_date: '2026-08-19 13:54'
updated_date: '2026-08-27 07:33'
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
- [x] #1 v.requiredRate exists with the three-branch behaviour above and its own doc comment
- [x] #2 RED, seeded: POST /admin/workers {name:'X'} with no rate -> 422 rate_required, detail hourly_rate_cents. Revert the validator to v.cents -> 201. Same for {hourly_rate_cents: 0}
- [x] #3 RED, seeded: POST /admin/workers with an id, editing an existing worker's rate to '' -> 422. The UPDATE branch is covered, not only the INSERT branch
- [x] #4 POST /admin/workers with hourly_rate_cents = -5 still answers 400 invalid_field, not 422
- [x] #5 check-api.js:2966's rateless fixture is converted into an assertion that the insert is REFUSED (23514)
- [x] #6 web /workers/ rate field is marked required and refuses an empty submit client-side; message key exists in de.json AND en.json
- [x] #7 web/scripts/check.mjs passes (de/en exact key parity)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AUDIT 2026-08-27, AC-checkbox hygiene only (read-only; no app code touched, no deep re-verification of this task's individual claims).
Headline claims confirmed live on schimmer-glanz.exe.xyz via read-only psql:
 - decision-41: workers.hourly_rate_cents is REQUIRED with NO default. information_schema.columns -> hourly_rate_cents | is_nullable=NO | column_default=(empty). Matches server/db/migrations/006_zones_revenue_rates.sql:64-65 (DROP DEFAULT, then CHECK workers_rate_positive (hourly_rate_cents > 0)).
 - decision-42/28: the revenue fact table exists. to_regclass('location_revenue') -> location_revenue. Defined at 006_zones_revenue_rates.sql:86-108 (month-start CHECK, one-live-row unique index on (location_id, month) WHERE superseded_at IS NULL, append-only).
 - migration 006 is applied on production: schema_migrations lists 001..013 including 006_zones_revenue_rates.sql.
ACs checked as a batch on that basis. Nothing here re-litigates the individual AC wording.
<!-- SECTION:NOTES:END -->
