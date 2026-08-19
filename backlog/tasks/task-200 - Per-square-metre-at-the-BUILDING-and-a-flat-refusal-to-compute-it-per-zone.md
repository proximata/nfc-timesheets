---
id: TASK-200
title: Per square metre at the BUILDING -- and a flat refusal to compute it per zone
status: To Do
assignee: []
created_date: '2026-08-19 14:09'
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
