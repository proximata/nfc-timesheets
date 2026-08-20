---
id: TASK-214
title: >-
  W1 web admin: an Operators screen — create, issue code, revoke, link to a
  worker
status: To Do
assignee: []
created_date: '2026-08-20 07:28'
labels:
  - web
  - operators
  - a11y
dependencies:
  - TASK-212
references:
  - web/app/workers
  - web/lib/nav.ts
documentation:
  - backlog/docs/OPERATOR-MODEL.md
  - backlog/decisions/decision-45
priority: medium
ordinal: 132000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Web-admin-facing half of decision-45. New screen (or a section on an existing one — follow IA-PLAN's object-surface convention, decision-38/39) that: lists operators (name, phone via phone_identities join, active, last enrolment code state); creates one (name + phone, normalised client-side via the same shape server/lib/validate.js's identityPhone enforces, with the server as the actual boundary); issues/revokes an enrolment code, same UI pattern as the existing worker enrolment-code control; shows the 'also a worker' link state read-only (worker name if phone_identities.worker_id is set) — the LINKING action itself (§3's 'operator → also worker' UPDATE) is named as a future one-click action in OPERATOR-MODEL.md §3 and is NOT required by this task.\n\nde/en EXACT key parity (decision-8). 390px must work (this is decision-28's admin-panel-works-on-a-phone territory — an operator screen is disproportionately likely to be opened FROM a phone). Colour is never the only signal for active/inactive or code-live/expired.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 an admin can create an operator with name + phone and see it in the list immediately
- [ ] #2 a phone already claimed by a worker or another operator is rejected with a specific, non-enumerating message — not a generic 500
- [ ] #3 issuing a code shows it ONCE, exactly like the worker enrolment-code control, and it is unrecoverable after navigating away
- [ ] #4 every string has an exact de/en key pair; pnpm check reports 0 parity mismatches
- [ ] #5 the screen is usable at 390px: no horizontal scroll, no control clipped
- [ ] #6 active/inactive and code-live/expired are distinguishable without colour (checked against audit-contrast.mjs's existing method)
<!-- AC:END -->
