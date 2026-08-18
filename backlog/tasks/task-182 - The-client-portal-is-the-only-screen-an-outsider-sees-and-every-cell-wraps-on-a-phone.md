---
id: TASK-182
title: >-
  The client portal is the only screen an outsider sees, and every cell wraps on
  a phone
status: To Do
assignee: []
created_date: '2026-08-18 18:55'
labels:
  - ux
dependencies: []
priority: low
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: docs/media/states/state-portal-ready-390-dark.png and state-portal-ready-1680-dark.png (regenerate with STATES_PHASE=2 STATES_ONLY=portal node demo/shoot-states.mjs \u2014 nfc_demo ships zero portal_grants, so this screen had never been photographed in its ready state).

At 390px the three-column table breaks every cell over two lines: 'Mo., 17.08.2026' wraps, 'Gereinigt von' wraps in the header, '2:15 Std.' wraps. Twenty rows at ~76px each. The link arrives by WhatsApp and is opened on a phone; that is the whole delivery path (JOURNEYS.md 3.C1).

Also on it, or rather not on it: the operator's name. The card shows the building name and a table. A client contact receiving a bare white card with their own building's name on it has nothing identifying who sent it.

FIX, and keep it small \u2014 this screen is a stated exception (REDESIGN-INVENTORY.md 14) and must not inherit any admin styling:
- the duration cell does not wrap
- a shorter date form at narrow widths, weekday kept
- the operator name in the card, from ops/branding.json, not hardcoded

DO NOT add a field to the payload. Exactly three fields per row is the GDPR minimisation and the reason this route is safe (server/routes/portal.js). DO NOT add admin chrome, a locale switcher or any link into the admin app.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At 390x844 a cleaning row occupies one line per column: neither the date nor the duration wraps
- [ ] #2 The card names the operator, read from ops/branding.json at build time, not a hardcoded string
- [ ] #3 The payload is unchanged: still exactly date, first name and minutes per row
- [ ] #4 No admin class, no admin nav, no locale switcher and no link into the admin app appears on /reinigung/
- [ ] #5 The four failure states still render as they do today: linkInvalid (one message for unknown, revoked and switched-off), tooMany, loadFailed, and the empty-but-valid case
- [ ] #6 Journey C2 (JOURNEYS.md 3.C2, client checks a building): a contact opening the link on a phone reads the last cleaning without horizontal scrolling and without pinch-zoom
<!-- AC:END -->
