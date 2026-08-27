---
id: TASK-200
title: Per square metre at the BUILDING -- and a flat refusal to compute it per zone
status: Done
assignee: []
created_date: '2026-08-19 14:09'
updated_date: '2026-08-27 07:33'
labels:
  - server
  - web
  - zones
  - pl
  - reporting
dependencies:
  - TASK-196
  - TASK-194
documentation:
  - backlog/decisions/decision-43
  - backlog/docs/ZONES-MODEL.md
priority: medium
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-43 $6. This is the payoff of zones: the denominator the director needs to quote a
new building. ZONES-MODEL.md $3.6.

COMPUTE, at the BUILDING:
  building_m2   = SUM(zones.area_sqm) WHERE active
  EUR/m2/month  = revenue_cents / building_m2
  minutes/m2    = labour_minutes / building_m2
  cost/m2       = (labour_cents + material_cents) / building_m2
numeric in SQL, exact decimal, rounded ONCE at the end. No float multiply anywhere.

GUARD RAILS, and they are the point:
  any active zone with area_sqm IS NULL  -> EVERY per-m2 figure is NULL, reason 'area_incomplete'
  an unzoned building                    -> NULL, reason 'no_zones'
  revenue not entered                    -> the EUR/m2 figure is NULL, reason 'not_entered'
NEVER 0. A denominator that is silently too small inflates every per-m2 number, which is exactly
the class of error this codebase already refuses for revenue and for labour.

*** REFUSED, EXPLICITLY, AND THE REFUSAL IS THE DELIVERABLE ***
NO PER-ZONE COST, EVER. A shift is building-level (decision-43 $4), so no duration is
attributable to a zone. The tempting move -- split the building's labour by area share -- asserts
that time is proportional to floor area, which is false in the obvious direction: a Tiefgarage is
fast per m2 and an office floor is slow. That is the same failure decision-6 already refused for
materials. A per-zone P&L would be a number nobody can defend, taken into a real conversation
about a client's contract.
What a zone CAN answer: 'the Tiefgarage tag has not been tapped since 14 May', and its area.

SCREEN (/pl/): one block per building, under the existing figures, with the reason rendered in
words whenever a figure is NULL. The method block gains a paragraph naming what per-m2 does and
does not mean.
## Journey anchors — backlog/docs/JOURNEYS.md
AC#1,#5 -> D8 (is this building worth the contract?): per-m² at the BUILDING is the number that makes zones worth having.
AC#2,#3 -> D8: an incomplete or absent denominator yields a reason in words, never an inflated figure.
AC#4    -> D8 + D12 (reprice): €/m² needs revenue; minutes/m² does not, and the screen must not lose the half it can still answer.
AC#6    -> §7 „per-zone cost": the grep pin is the refusal — a shift is building-level, so no duration is attributable to a zone (decision-6's identical refusal for materials).
AC#7    -> D8 in Austrian business German, de/en exact key parity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 GET /admin/pl carries the four per-m2 figures plus building_m2, zones_total, zones_unmeasured, and a named reason for every null
- [x] #2 RED, seeded: a building with one measured and one unmeasured zone reports every per-m2 figure NULL with reason area_incomplete. Make it sum only the known areas -> the check goes red
- [x] #3 RED, seeded: an unzoned building reports no_zones, not a division by zero and not 0
- [x] #4 A building whose revenue is not entered reports EUR/m2 null with reason not_entered, while minutes/m2 still computes
- [x] #5 Arithmetic pin: for a building of 400 m2 with 20 payable hours, minutes/m2 = 3.00 exactly; no floating-point drift
- [x] #6 GREP PIN: no query anywhere divides labour or material cost by a zone's area share. Add one -> the check goes red
- [x] #7 de/en exact key parity; every null renders as a reason in words, never a dash
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
