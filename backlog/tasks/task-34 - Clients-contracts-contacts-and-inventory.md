---
id: TASK-34
title: 'Clients, contracts, contacts and inventory'
status: Done
assignee: []
created_date: '2026-08-04 16:53'
updated_date: '2026-08-04 16:53'
labels:
  - web
  - server
  - db
dependencies: []
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retro-filed 2026-08-04 during backlog triage. Shipped in commit 58e6446 (migration 003) and extended by decision-28 (migration 005).

A building stopped being a name on a pin. It has an owner (client), a point of contact, and a price that is period-scoped rather than a single mutable number.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 clients, contacts and inventory_items exist with admin CRUD
- [x] #2 A building contract price is period-scoped, not a single mutable field
- [x] #3 The P&L values revenue at the price in force for that period
- [x] #4 Schema applied in production
<!-- AC:END -->



## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
EVIDENCE.
- Production tables (\dt on nfc): clients, contacts, location_contracts, inventory_items.
  clients=1, contacts=1 rows live. Migrations 003_clients_contracts_inventory.sql (2026-07-30)
  and 005_v2_features.sql (2026-08-03) both applied.
- Routes live (401, registered): POST|DELETE /admin/clients, POST|DELETE /admin/contacts,
  POST|DELETE /admin/inventory, GET|POST /admin/locations/:id/contracts,
  DELETE /admin/contracts/:id.
- Screens live (200): /clients/, /contracts/, /inventory/. Frames: admin-clients.png,
  admin-contracts.png, admin-inventory.png. The walkthrough
  docs/media/admin-walkthrough.mp4 shows /contracts/ at 139-145 s.
- AC2/AC3: location_contracts is (valid_from, valid_to), Vienna calendar dates, half-open. A
  March P&L therefore uses the March price even after a September increase — commit cfb402b
  ("payroll totals and shift rows now describe the same period") is the fix that made totals and
  rows agree.

KNOWN ASYMMETRY, recorded in decision-28 and NOT fixed here: revenue is period-correct, LABOUR
IS NOT. workers.hourly_rate_cents is one mutable column with no history, so every past month
labour cost is valued at today rate. Tracked in TASK-20. The P&L screen states it on screen
(pl.methodRates), so the number is never presented as something it is not.

decision-28 is still `status: proposed` rather than accepted — worth the owner five minutes,
because it is the record that makes the asymmetry above a decision instead of a bug.
<!-- SECTION:NOTES:END -->
