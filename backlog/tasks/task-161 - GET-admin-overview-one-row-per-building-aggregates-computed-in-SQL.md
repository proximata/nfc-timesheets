---
id: TASK-161
title: 'GET /admin/overview: one row per building, aggregates computed in SQL'
status: To Do
assignee: []
created_date: '2026-08-18 03:17'
labels:
  - ia
  - map
dependencies: []
documentation:
  - backlog/docs/MAP-HOME-SPEC.md
  - backlog/docs/IA-PLAN.md
priority: high
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The home screen today fetches /admin/data?limit=2000 - up to 2000 shift rows - to compute four counts. The map, the Objektliste and the Objektpanel need one row per building instead. Contract sketch: backlog/docs/MAP-HOME-SPEC.md section 8.5.

AGGREGATES ARE COMPUTED IN SQL, NOT IN THE BROWSER. /pl/ already makes this argument: browser arithmetic over a capped payload silently UNDER-REPORTS, and an under-reported margin is a business decision made on a wrong number. The aggregates must not be bounded by SHIFT_PAGE_MAX (2000).

Payload per building: id, slug, name, address, active, lat, lng, geocode_state, geocode_status, street_view_status, client_id, client_name, on_site[{worker_id, worker_name, since, minutes, zone_id, zone_name}], unresolved_count, open_count, material_open_count, last_clean{end, worker_name, zone_name, minutes}|null, month_minutes, target_minutes|null, contract_cents|null, margin_bp|null, margin_unknown_reason|null, rate_basis, zones[] (empty array for every building today - that is the normal case under decision-37).

REFUSALS THE PAYLOAD MUST CARRY, not the UI:
 - unknown revenue is NEVER a confident zero. margin_unknown_reason exists so /pl/'s revenueUnknown rule survives the trip.
 - target_minutes NULL means 'kein Monatsziel vereinbart', not 0 percent.
 - last_clean null means 'noch nie', which is a real answer and not an error. It comes from SQL, NOT from the capped shift list - a truncated payload must never read as 'this building was never cleaned'.
 - rate_basis carries the decision-28 caveat: past hours are valued at TODAY's rate.
 - one as_of stamp for the whole payload, so the map and the on-site table cannot disagree by a refresh.

Money is integer cents, time is integer minutes, timestamps ISO with Europe/Vienna applied at the formatting boundary only, including across DST. No new npm dependency: server deps stay pg + @sentry/node (decision-16 as amended by decision-23). The ledger blocks on / keep using /admin/data; this route does not replace it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 GET /admin/overview returns one row per building; payload is under 20 KB for 30 buildings (compare: ~400 KB for the shift payload)
- [ ] #2 Totals in the payload equal /payroll/'s totals for the same period, and are NOT capped by SHIFT_PAGE_MAX - proven with more than 2000 shifts in the database
- [ ] #3 A building with no contract returns margin_unknown_reason and NOT margin 0; a building with no target returns target_minutes null and NOT 0
- [ ] #4 A building never cleaned returns last_clean null, and that is distinguishable in the payload from a truncated or failed query
- [ ] #5 One as_of timestamp covers the whole payload
- [ ] #6 server/package.json dependencies are still exactly pg and @sentry/node
<!-- AC:END -->
