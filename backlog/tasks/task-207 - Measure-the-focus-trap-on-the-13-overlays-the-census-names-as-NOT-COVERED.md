---
id: TASK-207
title: Measure the focus trap on the 13 overlays the census names as NOT COVERED
status: To Do
assignee: []
created_date: '2026-08-20 04:03'
labels:
  - a11y
  - web
  - measured
dependencies: []
priority: medium
ordinal: 125000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED at 8702615. demo/audit-overlays.mjs prints its own census on every run and it is the evidence for this task:

  88/88 passed.  23 overlay call sites, 10 under the full contract.
  DEFERRED app/locations (2) app/pl (2) app/clients (3) app/contracts (2)
           app/inventory (1) app/material-requests (2) app/analytics (1)
           - NOT COVERED: the trap has never been measured on these

The full contract lives in one place, auditOverlay(): focus moves in, role=dialog + aria-modal + an accessible name, body scroll locked, Tab trapped, Shift+Tab trapped, Escape closes, focus back on the opener, scroll released. Before this round it was called on FIVE of twenty-three sites and the audit reported 56/56 - a number in which the missing eighteen do not appear. It is now 10 of 23 and the other 13 are NAMED ceilings rather than silence. That is the improvement; it is not the fix.

What it costs the client: a keyboard-only user opens a drawer on /clients/ or /material-requests/, Tab walks out of the dialog into the page behind it, and there is no measured evidence that it does not. /inventory/ and /material-requests/ are screens the director uses weekly.

The census itself is enforced - adding a second Drawer to app/inventory/page.tsx makes the run FAIL 'census - app/inventory/page.tsx: 2 on disk, census says 0 audited + 1 deferred'. So a NEW drawer cannot be added silently; only the existing thirteen are unmeasured.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 auditOverlay() is called on all 23 call sites, or every remaining DEFERRED entry states a reason that is not 'nobody has done it yet'
- [ ] #2 the census line reports 23 audited, 0 deferred, and the run stays at 0 FAILED
- [ ] #3 each newly audited overlay is listed with its focusable count, as the four added this round are
- [ ] #4 the negative case is exercised per screen: break the trap on one of them (return early from the Tab handler) and that screen's assertion goes red
- [ ] #5 AUDIT_BASE=http://127.0.0.1:8080 and the README's ORDER is respected - audit-overlays WRITES to nfc_demo and resolves the seed's unresolved shifts
<!-- AC:END -->
