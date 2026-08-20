---
id: TASK-200
title: Per square metre at the BUILDING -- and a flat refusal to compute it per zone
status: Done
assignee: []
created_date: '2026-08-19 14:09'
updated_date: '2026-08-20 04:02'
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
- [ ] #1 GET /admin/pl carries the four per-m2 figures plus building_m2, zones_total, zones_unmeasured, and a named reason for every null
- [ ] #2 RED, seeded: a building with one measured and one unmeasured zone reports every per-m2 figure NULL with reason area_incomplete. Make it sum only the known areas -> the check goes red
- [ ] #3 RED, seeded: an unzoned building reports no_zones, not a division by zero and not 0
- [ ] #4 A building whose revenue is not entered reports EUR/m2 null with reason not_entered, while minutes/m2 still computes
- [ ] #5 Arithmetic pin: for a building of 400 m2 with 20 payable hours, minutes/m2 = 3.00 exactly; no floating-point drift
- [ ] #6 GREP PIN: no query anywhere divides labour or material cost by a zone's area share. Add one -> the check goes red
- [ ] #7 de/en exact key parity; every null renders as a reason in words, never a dash
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
VERIFIED at 8702615 (backlog/docs/VERIFY-FINAL.md).
node demo/check-reports.mjs -> all checks green, incl. 'pl: an unassessable building is not reported as a pass'.
node server/check-api.js -> PASS. cd web && pnpm check -> ok 'lib/area.ts: a building area is summed as integers and never invented' and 'lib/area.ts: the tag question cannot even SEE a zone count (decision-43 §3)'.
AC#6, the grep pin, is enforced at the derivation: server/lib/reporting.js:517-523 refuses per-zone cost in prose AND demo/probe-zones-revenue.mjs now compares /pl/'s area against /locations/'s - the mutant that deletes sumArea's incomplete branch makes /locations/ print '980 m2 gesamt' while /pl/ says area_incomplete, and goes RED 6x (3 widths x 2 themes).
Per-m2 arithmetic re-derived by hand this session: cost 46408 c over 980 m2 -> Math.round(46408*100/980)/100 = 47.36 c/m2 -> Intl '0,47 EUR'. No float multiply; the only float is the display divide, after the rounding.
<!-- SECTION:NOTES:END -->
